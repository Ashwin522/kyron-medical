import { createGroq } from '@ai-sdk/groq';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { saveConversation } from '@/lib/db';

export const maxDuration = 30;

// Mock Doctors Data
const doctors = [
    { name: "Dr. Smith", specialty: "Orthopedics", treats: ["knee", "bone", "joint", "shoulder", "back", "hip", "ankle", "wrist", "spine", "fracture", "orthopedic", "musculoskeletal", "pain", "injury", "sport"] },
    { name: "Dr. Lee", specialty: "Dermatology", treats: ["skin", "rash", "acne", "mole", "hair", "eczema", "psoriasis", "dermatitis", "itching", "lesion", "dermatology", "nail"] },
    { name: "Dr. Patel", specialty: "Cardiology", treats: ["heart", "chest", "blood pressure", "hypertension", "cardiac", "palpitation", "artery", "cholesterol", "cardiovascular", "shortness of breath"] },
    { name: "Dr. Jones", specialty: "Neurology", treats: ["brain", "headache", "migraine", "nerve", "seizure", "dizziness", "memory", "stroke", "neurological", "numbness", "tingling", "tremor"] }
];

const availabilities: Record<string, string[]> = {
    "Dr. Smith": ["2026-03-20 09:00 AM", "2026-03-24 02:00 PM", "2026-04-05 10:00 AM"],
    "Dr. Lee": ["2026-03-19 11:00 AM", "2026-03-25 01:00 PM", "2026-04-10 03:00 PM"],
    "Dr. Patel": ["2026-03-22 08:30 AM", "2026-03-29 04:00 PM", "2026-04-15 09:15 AM"],
    "Dr. Jones": ["2026-03-21 10:30 AM", "2026-03-30 01:30 PM", "2026-04-12 11:00 AM"]
};

const bookedAppointments: any[] = [];

export async function POST(req: Request) {
    const { messages, patientData } = await req.json();
    const { firstName, lastName, reason, phone } = patientData || {};

    // --- PIONEER FEATURE: AI CONTINUITY (MEMORY) ---
    // Look up existing patient history for context
    let historyContext = "";
    try {
        const { getPatientByPhone } = require('@/lib/db');
        const existingPatient = phone ? await getPatientByPhone(phone) : null;

        if (existingPatient) {
            historyContext = `\n\n[RECOGNIZED PATIENT]: This user has visited before.
            Name: ${existingPatient.first_name} ${existingPatient.last_name}
            Previous History/Booking: ${existingPatient.last_conversation || 'None'}
            INSTRUCTION: Greet them by name ("Welcome back, ${existingPatient.first_name}!") and acknowledge their history.`;
        }
    } catch (dbErr) {
        console.warn('[Memory] Could not fetch patient history:', (dbErr as any).message);
    }

    const systemPrompt = `You are a medical scheduling assistant at Kyron Medical.
Help the patient schedule an appointment.

Available doctors and their specialties:
- Dr. Smith (Orthopedics): treats knee, bone, joint, back.
- Dr. Lee (Dermatology): treats skin, rash, acne.
- Dr. Patel (Cardiology): treats heart, chest pain.
- Dr. Jones (Neurology): treats brain, headache.

Doctor Availability:
- Dr. Smith: March 20 @ 9:00 AM, March 24 @ 2:00 PM
- Dr. Lee: March 19 @ 11:00 AM, March 25 @ 1:00 PM
- Dr. Patel: March 22 @ 8:30 AM, March 29 @ 4:00 PM
- Dr. Jones: March 21 @ 10:30 AM, March 30 @ 1:30 PM

INSTRUCTIONS:
1. Identify the right doctor based on the patient's concern.
2. Tell them which doctor they should see.
3. Offer them the available time slots for that doctor.
4. If they pick a slot, confirm the booking by calling the send_confirmation tool.
${historyContext}
5. Once the tool returns success, tell the patient that their confirmation has been sent.
- Email is always sent.
- SMS is only sent if they opted in during intake (this is handled automatically by the tool).

Current date: March 17, 2026.`;

    if (!process.env.GROQ_API_KEY) {
        console.error('[chat/route] GROQ_API_KEY is missing from environment.');
        return new Response(JSON.stringify({ error: 'AI processing is currently unavailable (API key missing).' }), { status: 500 });
    }

    try {
        const groq = createGroq({
            apiKey: process.env.GROQ_API_KEY,
        });

        const coreMessages = (messages || []).map((m: any) => ({
            role: m.role,
            content: m.content,
        }));

        const result = await streamText({
            model: groq('llama-3.3-70b-versatile'),
            system: systemPrompt + "\n\nWhen a patient confirms a slot, you MUST include this tag at the very end of your response: [CONFIRM: Doctor Name | Time]. This triggers the background confirmation process.",
            messages: coreMessages,
            onFinish: async ({ text }) => {
            const confirmMatch = text.match(/\[CONFIRM:\s*(.*?)\s*\|\s*(.*?)\s*\]/);
            if (confirmMatch) {
                const [_, doctor, time] = confirmMatch;
                const { email, phone, smsOptIn } = patientData || {};
                
                console.log(`[Confirmation] TRIGGERED via Tag. Doctor: ${doctor}, Time: ${time}`);
                
                // --- 1. LIVE EMAIL (Nodemailer + Gmail) ---
                const gmailUser = process.env.GMAIL_USER;
                const gmailPass = process.env.GMAIL_APP_PASSWORD;

                console.log(`[Debug] Attempting email. Recipient: ${email}, Agent: ${gmailUser ? 'Present' : 'MISSING'}, Pass: ${gmailPass ? 'Present' : 'MISSING'}`);

                if (gmailUser && gmailPass && gmailUser !== 'your-email@gmail.com') {
                    try {
                        const nodemailer = require('nodemailer');
                        // ... existing transporter setup ...
                        const transporter = nodemailer.createTransport({
                            service: 'gmail',
                            auth: {
                                user: gmailUser,
                                pass: gmailPass,
                            },
                        });

                        // --- NEW: GENERATE CALENDAR INVITE (.ics) ---
                        let attachments = [];
                        let googleUrl = "";
                        try {
                            const { createEvent } = require('ics');
                            // Parse "March 24 @ 2:00 PM" -> [2026, 3, 24, 14, 0]
                            const months: Record<string, number> = { 
                                january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
                                july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 
                            };
                            
                            const parts = time.toLowerCase().match(/(\w+)\s*(\d+)\s*@\s*(\d+):(\d+)\s*(am|pm)/);
                            if (parts) {
                                const [_, monthStr, day, hour, min, ampm] = parts;
                                let h = parseInt(hour);
                                if (ampm === 'pm' && h < 12) h += 12;
                                if (ampm === 'am' && h === 12) h = 0;
                                
                                // Format for Google Calendar (YYYYMMDDTHHMMSSZ)
                                const year = 2026;
                                const m = months[monthStr].toString().padStart(2, '0');
                                const d = day.padStart(2, '0');
                                const hs = h.toString().padStart(2, '0');
                                const ms = min.padStart(2, '0');
                                const startStr = `${year}${m}${d}T${hs}${ms}00`;
                                const endStr = `${year}${m}${d}T${(h+1).toString().padStart(2, '0')}${ms}00`;
                                
                                googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Appointment with ${doctor}`)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(`Confirmed appointment with ${doctor} at Kyron Medical.`)}&location=${encodeURIComponent('Kyron Medical Center')}`;

                                const event: any = {
                                    start: [2026, months[monthStr], parseInt(day), h, parseInt(min)],
                                    duration: { hours: 1 },
                                    title: `Appointment with ${doctor}`,
                                    description: `Confirmed appointment with ${doctor} at Kyron Medical.`,
                                    location: 'Kyron Medical Center',
                                    status: 'CONFIRMED',
                                    busyStatus: 'BUSY',
                                    organizer: { name: 'Kyron Medical', email: gmailUser }
                                };

                                const { error, value } = createEvent(event);
                                if (!error) {
                                    attachments.push({
                                        filename: 'appointment.ics',
                                        content: value,
                                        contentType: 'text/calendar'
                                    });
                                }
                            }
                        } catch (calErr) {
                            console.error('[Calendar] Failed to generate .ics:', calErr);
                        }

                        await transporter.sendMail({
                            from: `"Kyron Medical" <${gmailUser}>`,
                            to: email || '',
                            subject: 'Appointment Confirmed - Kyron Medical',
                            attachments: attachments,
                            html: `
                                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 600px; margin: auto;">
                                    <h2 style="color: #0070f3;">Appointment Confirmed!</h2>
                                    <p>Hello,</p>
                                    <p>Your appointment with <strong>${doctor}</strong> is confirmed for <strong>${time}</strong>.</p>
                                    
                                    <div style="margin: 30px 0;">
                                        <a href="${googleUrl}" target="_blank" style="background-color: #0070f3; color: white; padding: 12px 20px; border-radius: 5px; text-decoration: none; font-weight: bold; display: inline-block;">
                                            Add to Google Calendar
                                        </a>
                                    </div>

                                    <p style="font-size: 14px; color: #666;">
                                        <em>Other calendars: We have also attached an <strong>appointment.ics</strong> file for Outlook and Apple Calendar users.</em>
                                    </p>

                                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                                    <p style="font-size: 12px; color: #888;">Kyron Medical Center | 123 Healthcare Way | Syracuse, NY</p>
                                    <p style="font-size: 12px; color: #888;">Kyron Medical - Your AI Healthcare Partner</p>
                                </div>
                            `
                        });
                        console.log('[Confirmation] Email sent with Google Link & .ics Attachment.');
                    } catch (err) {
                        console.error('[Confirmation] Nodemailer error:', err);
                    }
                } else {
                    console.error('[Confirmation] Email SKIPPED. Logic check:', {
                        userSet: !!gmailUser,
                        passSet: !!gmailPass,
                        isPlaceholder: gmailUser === 'your-email@gmail.com',
                        recipientSet: !!email
                    });
                }

                // --- 2. LIVE SMS (Email-to-SMS Gateway) ---
                const { carrier } = patientData || {};
                if (smsOptIn && carrier) {
                    const gateways: Record<string, string> = {
                        verizon: 'vtext.com',
                        att: 'txt.att.net',
                        tmobile: 'tmomail.net',
                        sprint: 'messaging.sprintpcs.com',
                        mint: 'tmomail.net',
                        boost: 'myboostmobile.com',
                        cricket: 'mms.cricketwireless.net',
                        uscellular: 'email.uscc.net'
                    };

                    const gatewayDomain = gateways[carrier.toLowerCase()];
                    if (gatewayDomain && gmailUser && gmailPass && gmailUser !== 'your-email@gmail.com') {
                        try {
                            // Clean phone number: remove non-digits and leading '1' if present
                            let cleanPhone = (phone || '').replace(/\D/g, '');
                            if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
                                cleanPhone = cleanPhone.substring(1);
                            }
                            
                            const recipientEmail = `${cleanPhone}@${gatewayDomain}`;
                            
                            const nodemailer = require('nodemailer');
                            const transporter = nodemailer.createTransport({
                                service: 'gmail',
                                auth: { user: gmailUser, pass: gmailPass }
                            });

                            await transporter.sendMail({
                                from: `"Kyron Medical" <${gmailUser}>`,
                                to: recipientEmail,
                                subject: 'Appointment Update', // Some carriers require a subject
                                text: `Kyron Medical: Your appointment with ${doctor} is confirmed for ${time}.`
                            });
                            console.log(`[Confirmation] SMS sent via Gateway (${carrier}) to ${recipientEmail}`);
                        } catch (err) {
                            console.error('[Confirmation] Gateway SMS error:', err);
                        }
                    } else {
                        console.log('[Confirmation] SMS skipped: Gateway domain not found or Gmail not configured.');
                    }
                } else {
                    console.log('[Confirmation] SMS skipped: User did not opt-in or carrier missing.');
                }

                // --- 3. SAVE CONVERSATION (Memory Continuity) ---
                if (patientData) {
                    await saveConversation({
                        phone: patientData.phone || '',
                        first_name: patientData.firstName || '',
                        last_name: patientData.lastName || '',
                        email: patientData.email || '',
                        last_conversation: `Booked ${doctor} on ${time}`
                    }, text);
                    console.log('[Memory] Conversation saved to Supabase.');
                }
            }
        },
        onError: ({ error }) => {
            console.error('[chat/route] streamText error:', error);
        },
    });

    return result.toTextStreamResponse();
    } catch (error: any) {
        console.error('[chat/route] AI stream error:', error);
        return new Response(JSON.stringify({ 
            error: 'Failed to generate AI response.', 
            details: error.message 
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}

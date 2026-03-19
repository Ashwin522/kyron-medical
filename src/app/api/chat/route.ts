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

    const systemPrompt = `You are a specialized Medical Scheduling Assistant for Kyron Medical.

### SCOPE & IDENTITY:
- Your ONLY purpose is to help patients schedule appointments with the doctors listed below.
- You MUST politely decline any requests for general knowledge, creative writing, or drafting emails.
- If a user asks an off-topic question, respond: "I'm sorry, I am specialized only in Kyron Medical scheduling and cannot assist with that. Would you like to schedule an appointment with one of our doctors?"

### BOOKING RULES:
- **One Doctor Per Slot**: Joint consultations or multi-doctor appointments are NOT supported. A patient can see only ONE doctor at a time.
- **One Booking Per Request**: Do not attempt to book multiple slots at once. Only confirm ONE doctor and ONE time per interaction.
- If a user asks for a joint consultation, explain: "I can only schedule appointments with one specialist at a time to ensure dedicated care. Which doctor would you like to see first?"

### DOCTOR AVAILABILITY:
- Dr. Smith (Orthopedics): treats knee, bone, joint, back. Slots: March 20 @ 9:00 AM, March 24 @ 2:00 PM.
- Dr. Lee (Dermatology): treats skin, rash, acne. Slots: March 19 @ 11:00 AM, March 25 @ 1:00 PM.
- Dr. Patel (Cardiology): treats heart, chest pain. Slots: March 22 @ 8:30 AM, March 29 @ 4:00 PM.
- Dr. Jones (Neurology): treats brain, headache. Slots: March 21 @ 10:30 AM, March 30 @ 1:30 PM.

### INSTRUCTIONS:
1. Identify the right doctor based on the patient's concern.
2. Offer them the available time slots for that doctor.
${historyContext}
3. Once they pick a single valid slot, confirm by telling the user the booking is being processed.
4. After confirmation, inform the patient that their email and SMS (if opted-in) are on the way.

Current date: March 19, 2026.`;

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

                    // --- NEW: GUARDRAILS VALIDATION ---
                    try {
                        const { checkBookingConflict, createBooking } = require('@/lib/db');
                        
                        // 1. Basic validation against available slots
                        const doctorData = doctors.find(d => doctor.toLowerCase().includes(d.name.toLowerCase()) || d.name.toLowerCase().includes(doctor.toLowerCase()));
                        if (!doctorData || !availabilities[doctorData.name]?.includes(time)) {
                            console.warn(`[Guardrails] Invalid slot requested: ${doctor} at ${time}`);
                            return; // Don't send emails for invalid slots
                        }

                        // 2. Database conflict check
                        const conflict = await checkBookingConflict(phone, doctorData.name, time);
                        if (conflict.error) {
                            console.warn(`[Guardrails] Conflict detected: ${conflict.error}`);
                            return; // Don't send emails if double-booked
                        }

                        // 3. Create the booking record
                        await createBooking(phone, doctorData.name, time);
                        console.log(`[Guardrails] Slot secured in DB: ${doctorData.name} at ${time}`);

                    } catch (guardError) {
                        console.error('[Guardrails] Validation failed:', guardError);
                        // We still proceed if DB is down for demo purposes, but in real app we'd block
                    }

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
                                // Map months to numbers
                                const months: Record<string, number> = {
                                    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
                                    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
                                    aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
                                    nov: 11, november: 11, dec: 12, december: 12
                                };

                                // regex for "March 24 @ 2:00 PM"
                                const parts = time.toLowerCase().match(/(\w+)\s+(\d+)\s*@\s*(\d+):(\d+)\s*(am|pm)/);
                                if (parts) {
                                    const [_, monthStr, day, hour, min, ampm] = parts;
                                    let h = parseInt(hour);
                                    if (ampm === 'pm' && h < 12) h += 12;
                                    if (ampm === 'am' && h === 12) h = 0;

                                    const monthNum = months[monthStr] || 3;
                                    const dayNum = parseInt(day);

                                    // Format for Google Calendar (YYYYMMDDTHHMMSS)
                                    // We'll keep it as local time (no Z)
                                    const year = 2026;
                                    const fM = monthNum.toString().padStart(2, '0');
                                    const fD = dayNum.toString().padStart(2, '0');
                                    const fH = h.toString().padStart(2, '0');
                                    const fMin = min.padStart(2, '0');

                                    const startStr = `${year}${fM}${fD}T${fH}${fMin}00`;
                                    const endH = (h + 1).toString().padStart(2, '0');
                                    const endStr = `${year}${fM}${fD}T${endH}${fMin}00`;

                                    googleUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Appointment with ${doctor}`)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(`Confirmed appointment with ${doctor} at Kyron Medical.`)}&location=${encodeURIComponent('Kyron Medical Center')}&sf=true&output=xml`;

                                    const event: any = {
                                        start: [year, monthNum, dayNum, h, parseInt(min)],
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
                                <div style="font-family: Arial, sans-serif; padding: 40px; color: #333; line-height: 1.6; max-width: 600px; margin: auto; background-color: #f9f9f9; border-radius: 12px;">
                                    <div style="text-align: center; margin-bottom: 30px;">
                                        <h1 style="color: #0070f3; margin: 0;">Kyron Medical</h1>
                                        <p style="color: #666; font-size: 14px;">Your AI Healthcare Partner</p>
                                    </div>
                                    <div style="background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                                        <h2 style="margin-top: 0; color: #333;">Appointment Confirmed</h2>
                                        <p>Hello,</p>
                                        <p>Your appointment with <strong>${doctor}</strong> has been successfully scheduled.</p>
                                        <div style="background-color: #f0f7ff; padding: 15px; border-radius: 6px; margin: 20px 0;">
                                            <p style="margin: 0;"><strong>Date & Time:</strong> ${time}</p>
                                            <p style="margin: 5px 0 0 0;"><strong>Location:</strong> Kyron Medical Center, Syracuse, NY</p>
                                        </div>
                                        
                                        <div style="text-align: center; margin: 30px 0;">
                                            <a href="${googleUrl}" target="_blank" style="background-color: #0070f3; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block; font-size: 16px;">
                                                Add to Google Calendar
                                            </a>
                                        </div>
                                        
                                        <p style="font-size: 13px; color: #999; text-align: center;">
                                            Apple or Outlook user? Open the attached <strong>appointment.ics</strong> file.
                                        </p>
                                    </div>
                                    <div style="text-align: center; margin-top: 30px; color: #999; font-size: 12px;">
                                        <p>Kyron Medical Center | 123 Healthcare Way | Syracuse, NY</p>
                                        <p>© 2026 Kyron Medical. All rights reserved.</p>
                                    </div>
                                </div>
                            `
                            });
                            console.log('[Confirmation] Email sent with improved Google Link.');
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

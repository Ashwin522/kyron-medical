import { createGroq } from '@ai-sdk/groq';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import twilio from 'twilio';

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

                        await transporter.sendMail({
                            from: `"Kyron Medical" <${gmailUser}>`,
                            to: email || '',
                            subject: 'Appointment Confirmed - Kyron Medical',
                            html: `
                                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                                    <h2 style="color: #0070f3;">Appointment Confirmed!</h2>
                                    <p>Hello,</p>
                                    <p>Your appointment with <strong>${doctor}</strong> is confirmed for <strong>${time}</strong>.</p>
                                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                                    <p style="font-size: 12px; color: #888;">Kyron Medical - Your AI Healthcare Partner</p>
                                </div>
                            `
                        });
                        console.log('[Confirmation] Email sent via Gmail/Nodemailer.');
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

                // --- 2. LIVE SMS (Twilio) ---
                if (smsOptIn) {
                    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
                    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
                    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

                    if (twilioSid && twilioSid.startsWith('AC') && twilioToken && twilioFrom) {
                        try {
                            const client = twilio(twilioSid, twilioToken);
                            await client.messages.create({
                                body: `Kyron Medical: Your appointment with ${doctor} is confirmed for ${time}.`,
                                from: twilioFrom,
                                to: phone || ''
                            });
                            console.log('[Confirmation] SMS sent via Twilio.');
                        } catch (err) {
                            console.error('[Confirmation] Twilio error:', err);
                        }
                    } else {
                        console.log('[Confirmation] SMS skipped: Twilio credentials not configured.');
                    }
                } else {
                    console.log('[Confirmation] SMS skipped: User did not opt-in.');
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

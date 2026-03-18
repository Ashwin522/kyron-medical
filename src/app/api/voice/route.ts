import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { patientData, messages } = await req.json();

        if (!patientData?.phone) {
            return NextResponse.json({ error: 'Phone number is required for voice calls.' }, { status: 400 });
        }

        // Extract recent chat history for context - keeping it concise for voice
        const chatContext = (messages || [])
            .slice(-3) // last 3 messages for context
            .map((m: any) => `${m.role === 'user' ? 'Patient' : 'Assistant'}: ${m.content}`)
            .join('\n');

        const systemPrompt = `You are a friendly, efficient voice AI assistant for Kyron Medical calling ${patientData.firstName} ${patientData.lastName}.
Reason for appointment: "${patientData.reason}".
Previous chat context:
${chatContext}

GOAL: Continue the conversation, confirm their symptoms, and offer them time slots for the appropriate doctor.
Dr. Smith (Orthopedics) has slots at March 20 @ 9:00 AM.
Dr. Lee (Dermatology) has slots at March 19 @ 11:00 AM.

VOICE GUIDELINES:
- Be concise. Speak in short sentences.
- Avoid listing all doctors at once unless asked.
- If they pick a slot, say "Great, I'll get that scheduled for you."
- No medical advice. Emergency? Say "Call 911".`;

        const blandApiKey = process.env.BLAND_API_KEY;
        if (!blandApiKey) {
            console.warn("BLAND_API_KEY not set. Mocking voice call initialization.");
            return NextResponse.json({ 
                success: true, 
                mock: true, 
                message: "Voice call triggered (mock mode). Please add BLAND_API_KEY to .env.local for live calls." 
            });
        }

        // Optimized payload for Bland AI
        const response = await fetch('https://api.bland.ai/v1/calls', {
            method: 'POST',
            headers: {
                'authorization': blandApiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                phone_number: patientData.phone,
                task: systemPrompt,
                voice: 'maya',
                first_sentence: `Hi ${patientData.firstName}, this is Kyron Medical! I'm calling to help you finish scheduling that appointment for your ${patientData.reason}. How are you doing today?`,
                wait_for_greeting: true,
                record: true,
                max_duration: 5, // 5 minutes is plenty for scheduling
            }),
        });

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to initiate call.' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { getPatientByPhone } from '@/lib/db';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { from } = body; // Bland AI sends the caller's number in 'from'

        if (!from) {
            return NextResponse.json({ error: 'Missing phone number' }, { status: 400 });
        }

        const patient = await getPatientByPhone(from);

        if (patient) {
            console.log(`[Inbound] Recognized returning patient: ${patient.first_name}`);
            
            // This is what Bland AI will see and "remember"
            return NextResponse.json({
                context: `You are talking to ${patient.first_name} ${patient.last_name}. 
                They previously booked an appointment for: ${patient.last_conversation || 'Unknown'}.
                If they call back, acknowledge them by name and offer to help with any follow-up questions about their booking.`,
                greeting: `Hi ${patient.first_name}! Welcome back to Kyron Medical. I remember we were just talking about your appointment. How can I help you further?`
            });
        }

        return NextResponse.json({
            context: "This is a new patient. Perform the standard intake process.",
            greeting: "Hello! Welcome to Kyron Medical. How can I assist you today?"
        });

    } catch (err) {
        console.error('[Inbound Webhook Error]:', err);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

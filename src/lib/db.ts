import { supabase } from './supabase';

export interface PatientRecord {
    id?: string;
    phone: string;
    first_name: string;
    last_name: string;
    email: string;
    last_conversation?: string;
    appointment_status?: string;
}

export async function getPatientByPhone(phone: string) {
    if (!supabase) {
        console.warn('[DB] Supabase client not initialized (missing env vars).');
        return null;
    }
    const cleanPhone = phone.replace(/\D/g, '');
    const { data, error } = await supabase
        .from('patients')
        .select('*')
        .or(`phone.eq.${cleanPhone},phone.eq.1${cleanPhone},phone.eq.+1${cleanPhone}`)
        .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
        console.error('Error fetching patient:', error);
    }
    return data;
}

export async function saveConversation(patientData: PatientRecord, transcript: string) {
    if (!supabase) {
        console.warn('[DB] Supabase client not initialized (missing env vars).');
        return null;
    }
    const cleanPhone = patientData.phone.replace(/\D/g, '');
    
    // 1. Upsert patient
    const { data: patient, error: pError } = await supabase
        .from('patients')
        .upsert({
            phone: cleanPhone,
            first_name: patientData.first_name,
            last_name: patientData.last_name,
            email: patientData.email,
            last_conversation: transcript,
            updated_at: new Date().toISOString()
        }, { onConflict: 'phone' })
        .select()
        .single();

        if (pError) {
        console.error('Error saving patient/conversation:', pError);
        return null;
    }
    return patient;
}

/**
 * Checks if a slot is already taken for a specific doctor or patient.
 */
export async function checkBookingConflict(phone: string, doctor: string, time: string) {
    if (!supabase) return { error: 'Database not initialized' };
    
    try {
        const cleanPhone = phone.replace(/\D/g, '');
        
        // Check if doctor is busy
        const { data: doctorBusy } = await supabase
            .from('bookings')
            .select('*')
            .eq('doctor_name', doctor)
            .eq('booking_time', time)
            .maybeSingle();

        if (doctorBusy) return { error: `Dr. ${doctor} is already booked at that time.` };

        // Check if patient is busy
        const { data: patientBusy } = await supabase
            .from('bookings')
            .select('*')
            .eq('patient_phone', cleanPhone)
            .eq('booking_time', time)
            .maybeSingle();

        if (patientBusy) return { error: 'You already have another appointment at this time.' };

        return { success: true };
    } catch (err) {
        console.error('[Guardrails] Conflict check failed:', err);
        return { error: 'Failed to verify availability' };
    }
}

/**
 * Persists a new booking to the database.
 */
export async function createBooking(phone: string, doctor: string, time: string) {
    if (!supabase) return null;
    try {
        const cleanPhone = phone.replace(/\D/g, '');
        const { data, error } = await supabase
            .from('bookings')
            .insert({
                patient_phone: cleanPhone,
                doctor_name: doctor,
                booking_time: time
            });
        
        if (error) throw error;
        console.log('[Guardrails] Booking record created.');
        return data;
    } catch (err) {
        console.error('[Guardrails] Failed to create booking:', err);
        return null;
    }
}

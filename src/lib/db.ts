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

'use client';

import React, { useState } from 'react';
import IntakeForm from '@/components/IntakeForm';
import ChatInterface from '@/components/ChatInterface';

export default function Home() {
  const [patientData, setPatientData] = useState<any>(null);

  return (
    <main className="container" style={{ paddingTop: '3rem', paddingBottom: '3rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '3.5rem', fontWeight: 700, background: 'linear-gradient(to right, #0ea5e9, #2dd4bf)', WebkitBackgroundClip: 'text', color: 'transparent', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>Kyron Medical</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.2rem', fontWeight: 300 }}>Intelligent Patient Intake & Scheduling</p>
      </div>

      {!patientData ? (
        <IntakeForm onSubmit={setPatientData} />
      ) : (
        <ChatInterface patientData={patientData} />
      )}
    </main>
  );
}

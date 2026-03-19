'use client';

import React, { useState } from 'react';

export default function IntakeForm({ onSubmit }: { onSubmit: (data: any) => void }) {
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', dob: '', phone: '', email: '', reason: '', carrier: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="glass-panel animate-fade-in" style={{ padding: '2.5rem', maxWidth: '32rem', margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.75rem', marginBottom: '2rem', textAlign: 'center', fontWeight: 600 }}>Patient Intake Form</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <input required name="firstName" placeholder="First Name" className="glass-input" onChange={handleChange} />
          <input required name="lastName" placeholder="Last Name" className="glass-input" onChange={handleChange} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>Date of Birth</label>
          <input required type="date" name="dob" className="glass-input" onChange={handleChange} />
        </div>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <input required type="tel" name="phone" placeholder="Phone Number" className="glass-input" style={{ flex: 1.5 }} onChange={handleChange} />
          <select required name="carrier" className="glass-input" style={{ flex: 1 }} onChange={handleChange}>
            <option value="">Carrier</option>
            <option value="verizon">Verizon</option>
            <option value="att">AT&T</option>
            <option value="tmobile">T-Mobile</option>
            <option value="sprint">Sprint</option>
            <option value="mint">Mint</option>
            <option value="boost">Boost</option>
            <option value="cricket">Cricket</option>
          </select>
        </div>
        <input required type="email" name="email" placeholder="Email Address" className="glass-input" onChange={handleChange} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0 0.5rem' }}>
          <input 
            type="checkbox" 
            id="smsOptIn" 
            name="smsOptIn" 
            style={{ width: '1.125rem', height: '1.125rem', cursor: 'pointer', accentColor: 'var(--color-primary)' }} 
            onChange={(e) => setFormData({ ...formData, smsOptIn: e.target.checked } as any)} 
          />
          <label htmlFor="smsOptIn" style={{ fontSize: '0.875rem', cursor: 'pointer', userSelect: 'none' }}>
            Receive appointment updates via text message
          </label>
        </div>
        <textarea required name="reason" placeholder="Reason for appointment (e.g. knee pain, skin rash, heart checkup)..." className="glass-input" style={{ resize: 'vertical', minHeight: '120px' }} onChange={handleChange}></textarea>
        <button type="submit" className="glass-button" style={{ marginTop: '1rem', width: '100%' }}>Connect to AI Scheduler</button>
      </form>
    </div>
  );
}

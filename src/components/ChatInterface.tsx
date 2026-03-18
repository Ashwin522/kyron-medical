// @ts-nocheck
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { PhoneCall, Send, Loader2 } from 'lucide-react';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

export default function ChatInterface({ patientData }: { patientData: any }) {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            role: 'assistant',
            content: `Hello ${patientData?.firstName || ''}, I see you're looking to schedule an appointment for: "${patientData?.reason || ''}". Let me find the right specialist for you!`
        }
    ]);
    const [inputStr, setInputStr] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    // The initial greeting message ID — we exclude it from API calls
    const GREETING_ID = '1';

    const sendMessage = async (text: string) => {
        if (!text.trim() || isLoading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: text.trim()
        };

        const updatedMessages = [...messages, userMessage];
        setMessages(updatedMessages);
        setInputStr('');
        setIsLoading(true);
        setError(null);

        // Placeholder for streaming AI response
        const assistantId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

        try {
            // Exclude the hardcoded greeting from what we send to the API
            const apiMessages = updatedMessages
                .filter(m => m.id !== GREETING_ID)
                .map(m => ({ role: m.role, content: m.content }));

            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: apiMessages, patientData })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText || 'API error');
            }

            if (!response.body) throw new Error('No response body');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulated = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // toTextStreamResponse sends plain text chunks
                accumulated += decoder.decode(value, { stream: true });

                setMessages(prev =>
                    prev.map(m =>
                        m.id === assistantId ? { ...m, content: accumulated } : m
                    )
                );
            }
        } catch (e: any) {
            setError(e.message || 'Failed to get response');
            setMessages(prev => prev.filter(m => m.id !== assistantId));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="glass-panel animate-fade-in" style={{ height: '75vh', padding: '1.5rem', display: 'flex', flexDirection: 'column', maxWidth: '48rem', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--color-glass-border)' }}>
                <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Kyron Assistant</h2>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Scheduling for {patientData?.firstName} {patientData?.lastName}</p>
                </div>
                <button
                    type="button"
                    onClick={async () => {
                        try {
                            const res = await fetch('/api/voice', {
                                method: 'POST',
                                body: JSON.stringify({ patientData, messages })
                            });
                            const data = await res.json();
                            if (res.ok) {
                                alert('Phone call initiated. You will receive a call from our Voice AI shortly!');
                            } else {
                                alert('Error initiating call: ' + data.error);
                            }
                        } catch (e) {
                            alert('Network error initiating call.');
                        }
                    }}
                    className="glass-button secondary pulse"
                    style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                >
                    <PhoneCall size={16} /> Opt for Phone Call
                </button>
            </div>

            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', marginBottom: '1.5rem', paddingRight: '0.5rem', display: 'flex', flexDirection: 'column' }}>
                {messages.map(m => (
                    <div key={m.id} className={`message ${m.role === 'user' ? 'message-user' : 'message-ai'}`}>
                        {m.content || (m.role === 'assistant' && isLoading ? <Loader2 size={16} className="animate-spin" /> : '')}
                    </div>
                ))}
            </div>

            {error && (
                <div style={{ padding: '1rem', background: 'rgba(255,0,0,0.1)', border: '1px solid rgba(255,0,0,0.3)', borderRadius: '1rem', marginBottom: '1rem', color: '#fca5a5', fontSize: '0.875rem' }}>
                    <strong>Error:</strong> {error}
                </div>
            )}

            <form onSubmit={(e) => {
                e.preventDefault();
                sendMessage(inputStr);
            }} style={{ display: 'flex', gap: '0.75rem', position: 'relative' }}>
                <input
                    className="glass-input"
                    placeholder="Type your message..."
                    style={{ flex: 1 }}
                    value={inputStr}
                    onChange={(e) => setInputStr(e.target.value)}
                    disabled={isLoading}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage(inputStr);
                        }
                    }}
                />
                <button
                    type="submit"
                    className="glass-button"
                    style={{ padding: '0 1.25rem' }}
                    disabled={isLoading || !inputStr.trim()}
                >
                    {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
            </form>
        </div>
    );
}

import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kyron Medical | AI Patient Intake',
  description: 'Intelligent patient intake and scheduling system via Kyron Medical.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

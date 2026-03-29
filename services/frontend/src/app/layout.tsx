import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Fleet Track | Monitoramento de Frotas',
  description: 'Dashboard de monitoramento de frotas em tempo real — Pinheirinho, Curitiba',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={inter.className}>
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}

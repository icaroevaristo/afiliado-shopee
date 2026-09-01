import './globals.css';
import type { Metadata } from 'next';
import { AppShell } from '../components/app-shell';

export const metadata: Metadata = {
  title: 'Shopee Affiliate',
  description: 'Operação diária das ofertas e envios do Shopee Affiliate.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

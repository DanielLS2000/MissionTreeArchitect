import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'EU4 Mission Tree Architect', description: 'IDE visual local de Mission Trees do Europa Universalis IV.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}

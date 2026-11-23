/** Re-mounted on every navigation: gives each page a short, quiet entrance. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>;
}

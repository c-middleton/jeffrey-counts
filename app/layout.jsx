import "./globals.css";

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "Jeffrey Counts",
  description: "Jeffrey Counts boats on the lake.",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Jeffrey Counts",
    description: "Count boats before they drift away.",
    images: ["/assets/jeffrey-counts-landing-desktop.jpg"],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#123c55",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

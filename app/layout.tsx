import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Support Lab — AI support, learning in the loop",
  description:
    "An observable AI support simulator with real tools and verified learning.",
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

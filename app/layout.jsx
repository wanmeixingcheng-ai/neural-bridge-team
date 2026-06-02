import "./globals.css";

export const metadata = {
  title: "Neural Bridge 项目工作台",
  description: "19名AI团队成员协作工作台",
  manifest: "/manifest.json",
  other: {
    "nb-build": "mobile-restore-natural-20260602-1230",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2d6fbe",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh">
      <body style={{ margin: 0, padding: 0, background: "#eef1f7" }}>
        {children}
      </body>
    </html>
  );
}

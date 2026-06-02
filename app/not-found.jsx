export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#eef1f7",
        color: "#1a1a2e",
        fontFamily: "'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "24px",
          border: "1px solid #e4e8ef",
          borderRadius: "16px",
          background: "#ffffff",
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 900 }}>
          页面不存在
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: "13px", color: "#8a93a8" }}>
          请返回 Neural Bridge 项目工作台继续操作。
        </p>
      </section>
    </main>
  );
}

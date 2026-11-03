export function AngelHalo({ size = 48 }: { size?: number }) {
  return (
    <div
      className="angel-halo"
      style={{ width: size, height: size }}
      aria-label="Angel assistant"
      role="img"
    >
      <span className="angel-halo-outer" />
      <span className="angel-halo-inner" />
      <span className="angel-halo-face" aria-hidden="true">😇</span>
    </div>
  );
}

export function AngelChatBubble({
  role,
  text,
}: {
  role: "angel" | "user";
  text: string;
}) {
  return (
    <div className={`angel-chat-bubble ${role}`}>
      <strong>{role === "angel" ? "Angel · Control Editor" : "You"}</strong>
      <span>{text}</span>
    </div>
  );
}

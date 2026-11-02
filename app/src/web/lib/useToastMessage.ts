import { useCallback, useRef, useState } from "react";

export interface ToastMessage {
  type: "success" | "error";
  text: string;
}

export function useToastMessage(timeoutMs = 5000) {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showMsg = useCallback(
    (type: ToastMessage["type"], text: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setMessage({ type, text });
      timerRef.current = setTimeout(() => setMessage(null), timeoutMs);
    },
    [timeoutMs],
  );

  return { message, showMsg, setMessage };
}

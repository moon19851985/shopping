/** إشعار دفع Expo — يعمل على الجوال حتى لو التطبيق في الخلفية */
export async function sendCaptainPushNotification(
  expoPushToken: string,
  payload: { title: string; body: string; orderId: string }
) {
  if (!expoPushToken.startsWith("ExponentPushToken") && !expoPushToken.startsWith("ExpoPushToken")) {
    return;
  }

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: expoPushToken,
        sound: "default",
        priority: "high",
        channelId: "captain-orders",
        title: payload.title,
        body: payload.body,
        data: { orderId: payload.orderId, screen: "captain" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[push] فشل الإرسال:", text);
    }
  } catch (e) {
    console.error("[push] خطأ:", e);
  }
}

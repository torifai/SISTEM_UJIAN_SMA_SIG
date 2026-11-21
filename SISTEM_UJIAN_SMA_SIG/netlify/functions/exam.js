exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, message: "Method not allowed." }) };
  }
  const target = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!target) {
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, message: "Environment variable GOOGLE_APPS_SCRIPT_URL belum diatur di Netlify." }) };
  }
  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: event.body || "{}"
    });
    const body = await upstream.text();
    return { statusCode: upstream.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body };
  } catch (error) {
    return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, message: "Gagal menghubungi Google Apps Script." }) };
  }
};

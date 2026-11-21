
(() => {
  "use strict";

  const cfg = window.APP_CONFIG;
  const $ = id => document.getElementById(id);

  const views = [
    "loginView",
    "adminLoginView",
    "dashboardView",
    "subjectTokenView",
    "examView",
    "doneView",
    "adminDashboardView"
  ];

  let sessionToken = "";
  let selectedSubject = "";
  let examActive = false;
  let finishing = false;
  let violationHandling = false;

  let deadline = 0;
  let timerId = null;
  let statusPollId = null;
  let adminPollId = null;

  let adminToken = "";
  let adminBusy = false;
  let adminRefreshing = false;
  let audioContext = null;

  $("year").textContent = new Date().getFullYear();

  function show(viewId) {
    views.forEach(id => {
      $(id).classList.toggle("hidden", id !== viewId);
    });
  }

  function message(id, text, good = false) {
    $(id).textContent = text || "";
    $(id).style.color = good ? "#16814c" : "#b54735";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  async function api(action, data = {}) {
    let response;

    try {
      response = await fetch(cfg.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
          "Accept": "application/json"
        },
        body: JSON.stringify({ action, ...data })
      });
    } catch {
      throw new Error(
        "Tidak dapat menghubungi server. Periksa koneksi internet."
      );
    }

    const raw = await response.text();
    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      throw new Error(
        "Respons server bukan JSON. Periksa URL Apps Script dan Netlify Function."
      );
    }

    if (!response.ok || result.ok === false) {
      throw new Error(result.message || "Permintaan gagal.");
    }

    return result;
  }

  function unlockAudio() {
    try {
      if (!audioContext) {
        audioContext = new (
          window.AudioContext || window.webkitAudioContext
        )();
      }

      if (audioContext.state === "suspended") {
        audioContext.resume();
      }
    } catch (e) {
      console.warn("Audio tidak tersedia:", e);
    }
  }

  function playAlarm() {
    if (!audioContext) return;

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    const now = audioContext.currentTime;

    for (let i = 0; i < 4; i++) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = "square";
      oscillator.frequency.value = 1000;

      gain.gain.setValueAtTime(0.3, now + i * 0.4);
      gain.gain.setValueAtTime(0, now + i * 0.4 + 0.2);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);

      oscillator.start(now + i * 0.4);
      oscillator.stop(now + i * 0.4 + 0.2);
    }
  }

  function formatTime(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));

    return (
      String(Math.floor(seconds / 60)).padStart(2, "0") +
      ":" +
      String(seconds % 60).padStart(2, "0")
    );
  }

  async function logActivity(activity, detail) {
    if (!sessionToken || !selectedSubject) return;

    try {
      await api("activity", {
        sessionToken,
        subject: selectedSubject,
        activity,
        detail
      });
    } catch (e) {
      console.warn("Log aktivitas gagal:", e.message);
    }
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function startTimer() {
    stopTimer();

    const tick = () => {
      const left = Math.max(0, deadline - Date.now());

      $("timer").textContent = formatTime(left);

      if (left <= 0) {
        finishExam(
          "WAKTU_HABIS",
          "Waktu ujian telah berakhir."
        );
      }
    };

    tick();
    timerId = setInterval(tick, 1000);
  }

  function stopStatusPolling() {
    if (statusPollId) clearInterval(statusPollId);
    statusPollId = null;
  }

  function startStatusPolling() {
    stopStatusPolling();

    statusPollId = setInterval(() => {
      checkParticipantStatus();
    }, 3000);
  }

  function showLocked(remainingMs) {
    stopTimer();

    $("lockedOverlay").classList.remove("hidden");
    $("finishBtn").disabled = true;

    $("lockedTimer").textContent =
      "Sisa waktu tersimpan: " + formatTime(remainingMs);

    $("examNotice").textContent =
      "Ujian dikunci sementara oleh administrator. Mohon menunggu.";

    $("examStatus").textContent =
      "UJIAN DIKUNCI ADMINISTRATOR";

    $("examNotice").classList.add("violation");
  }

  function hideLocked() {
    $("lockedOverlay").classList.add("hidden");
    $("finishBtn").disabled = false;

    $("examNotice").textContent =
      "Jangan menutup halaman ujian atau berpindah tab. Aktivitas halaman akan dicatat.";

    $("examNotice").classList.remove("violation");
    $("examStatus").textContent =
      "Pastikan jawaban sudah dikirim melalui Google Form.";
  }

  async function checkParticipantStatus() {
    if (!examActive || finishing || !sessionToken) return;

    try {
      const result = await api("checkExamStatus", {
        sessionToken,
        subject: selectedSubject
      });

      if (!examActive || finishing) return;

      if (result.status === "DIKUNCI_ADMIN") {
        showLocked(Number(result.remainingMs || 0));
        return;
      }

      if (result.status === "BERLANGSUNG") {
        const newDeadline = Number(result.deadline);

        if (!Number.isFinite(newDeadline)) return;

        if ($("lockedOverlay").classList.contains("hidden") === false) {
          deadline = newDeadline;
          hideLocked();
          startTimer();
        }

        return;
      }

      if (
        result.status === "DIHENTIKAN_ADMIN" ||
        result.status === "SELESAI" ||
        result.status === "PELANGGARAN" ||
        result.status === "WAKTU HABIS"
      ) {
        await closeByServer(result.status);
      }

    } catch (e) {
      console.warn("Pemeriksaan status gagal:", e.message);
    }
  }

  async function closeByServer(status) {
    if (!examActive || finishing) return;

    finishing = true;
    examActive = false;

    stopTimer();
    stopStatusPolling();

    $("finishBtn").disabled = true;
    $("examFrame").src = "about:blank";

    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (_) {}
    }

    $("doneTitle").textContent =
      status === "DIHENTIKAN_ADMIN"
        ? "Ujian Dihentikan Admin"
        : "Ujian " + status;

    $("doneMessage").textContent =
      status === "DIHENTIKAN_ADMIN"
        ? "Ujian Anda telah diakhiri oleh administrator. Silakan hubungi pengawas."
        : "Status ujian Anda: " + status + ".";

    show("doneView");
    finishing = false;
  }

  async function finishExam(
    status = "SELESAI",
    reason = "Peserta menyelesaikan ujian."
  ) {
    if (!examActive || finishing) return;

    if (!$("lockedOverlay").classList.contains("hidden")) {
  return;

    }

    finishing = true;
    stopTimer();
    stopStatusPolling();

    $("finishBtn").disabled = true;

    try {
      const result = await api("finish", {
        sessionToken,
        subject: selectedSubject,
        status,
        reason
      });

      examActive = false;
      finishing = false;
      violationHandling = false;

      $("examFrame").src = "about:blank";

      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch (_) {}
      }

      $("doneTitle").textContent =
        "Ujian " + (result.status || status);

      $("doneMessage").textContent =
        reason + " Silakan kembali ke dashboard.";

      show("doneView");

    } catch (e) {
      $("examStatus").textContent =
        "Gagal menyimpan status: " + e.message;

      $("finishBtn").disabled = false;
      finishing = false;
      violationHandling = false;

      startTimer();
      startStatusPolling();
    }
  }

  async function handleViolation(activity, detail, reason) {
  if (!examActive || finishing || violationHandling) return;

  if (!$("lockedOverlay").classList.contains("hidden")) {
    return;
  }

  violationHandling = true;

  playAlarm();

  $("examNotice").textContent =
    reason + " Sistem sedang mencatat pelanggaran.";

  $("examNotice").classList.add("violation");

  await logActivity(activity, detail);

  await finishExam("PELANGGARAN", reason);
}

  // =========================================
  // LOGIN PESERTA
  // =========================================

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();

    const btn = e.submitter;
    const participantName = $("participantName").value.trim();
    const token = $("loginToken").value.trim();

    if (!participantName || !token) {
      message("loginMessage", "Nama dan token wajib diisi.");
      return;
    }

    btn.disabled = true;
    message("loginMessage", "Memeriksa identitas dan token...");

    try {
      const result = await api("login", {
        participantName,
        token
      });

      sessionToken = result.sessionToken;

      $("loginToken").value = "";

      message("loginMessage", "");
      message(
        "dashboardMessage",
        "Selamat datang, " + participantName,
        true
      );

      show("dashboardView");

    } catch (e) {
      message("loginMessage", e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // =========================================
  // NAVIGASI LOGIN ADMIN
  // =========================================

  $("showAdminLogin").addEventListener("click", () => {
    message("adminLoginMessage", "");
    $("adminLoginForm").reset();
    show("adminLoginView");
  });

  $("backToParticipant").addEventListener("click", () => {
    message("loginMessage", "");
    show("loginView");
  });

  // =========================================
  // LOGIN ADMIN
  // =========================================

  $("adminLoginForm").addEventListener("submit", async e => {
    e.preventDefault();

    const btn = e.submitter;

    btn.disabled = true;

    message("adminLoginMessage", "Memverifikasi akun administrator...");

    try {
      const result = await api("adminLogin", {
        username: $("adminUsername").value.trim(),
        password: $("adminPassword").value
      });

      adminToken = result.adminToken;

      $("adminLoginForm").reset();

      message("adminLoginMessage", "");
      show("adminDashboardView");

      await loadAdminDashboard();

      startAdminPolling();

    } catch (e) {
      message("adminLoginMessage", e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // =========================================
  // DASHBOARD ADMIN
  // =========================================

  function statusLabel(status) {
    const labels = {
      "BERLANGSUNG": "BERLANGSUNG",
      "DIKUNCI_ADMIN": "TERKUNCI",
      "SELESAI": "SELESAI",
      "WAKTU HABIS": "WAKTU HABIS",
      "PELANGGARAN": "PELANGGARAN",
      "DIHENTIKAN_ADMIN": "DIHENTIKAN"
    };

    return labels[status] || status || "-";
  }

  function statusClass(status) {
    if (status === "BERLANGSUNG") return "status-active";
    if (status === "DIKUNCI_ADMIN") return "status-locked";

    return "status-finished";
  }

  function getRemaining(participant) {
    if (participant.status === "DIKUNCI_ADMIN") {
      return Number(participant.remainingMs || 0);
    }

    if (participant.status === "BERLANGSUNG") {
      return Number(participant.remainingMs || 0);
    }

    return 0;
  }

  function renderParticipants(participants) {
    const tbody = $("participantTableBody");

    if (!participants.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="empty-table">
            Belum ada peserta yang memulai ujian.
          </td>
        </tr>`;
      return;
    }

    let html = "";

    participants.forEach((p, index) => {
      const status = String(p.status || "");
      const remaining = formatTime(getRemaining(p));

      let controls = '<span class="muted">Tidak ada tindakan</span>';

      if (status === "BERLANGSUNG") {
        controls = `
          <div class="control-buttons">
            <button class="action-lock"
              data-action="lock"
              data-session="${escapeHtml(p.sessionToken)}"
              data-subject="${escapeHtml(p.subject)}">
              Kunci
            </button>
            <button class="action-finish"
              data-action="finish"
              data-session="${escapeHtml(p.sessionToken)}"
              data-subject="${escapeHtml(p.subject)}">
              Akhiri
            </button>
          </div>`;
      }

      if (status === "DIKUNCI_ADMIN") {
        controls = `
          <div class="control-buttons">
            <button class="action-unlock"
              data-action="unlock"
              data-session="${escapeHtml(p.sessionToken)}"
              data-subject="${escapeHtml(p.subject)}">
              Buka Kembali
            </button>
            <button class="action-finish"
              data-action="finish"
              data-session="${escapeHtml(p.sessionToken)}"
              data-subject="${escapeHtml(p.subject)}">
              Akhiri
            </button>
          </div>`;
      }

      html += `
        <tr>
          <td>${index + 1}</td>
          <td class="participant-name">
            ${escapeHtml(p.participantName)}
          </td>
          <td>${escapeHtml(p.subject)}</td>
          <td>
            <span class="status-badge ${statusClass(status)}">
              ${escapeHtml(statusLabel(status))}
            </span>
          </td>
          <td class="time-cell">${remaining}</td>
          <td>${controls}</td>
        </tr>`;
    });

    tbody.innerHTML = html;
  }

  async function loadAdminDashboard() {
    if (!adminToken || adminRefreshing) return;

    adminRefreshing = true;

    try {
      const result = await api("adminDashboard", {
        adminToken
      });

      const participants = Array.isArray(result.participants)
        ? result.participants
        : [];

      $("totalParticipants").textContent = participants.length;

      $("activeParticipants").textContent =
        participants.filter(p => p.status === "BERLANGSUNG").length;

      $("lockedParticipants").textContent =
        participants.filter(p => p.status === "DIKUNCI_ADMIN").length;

      $("finishedParticipants").textContent =
        participants.filter(p =>
          p.status !== "BERLANGSUNG" &&
          p.status !== "DIKUNCI_ADMIN"
        ).length;

      renderParticipants(participants);

      message("adminMessage", "Data berhasil diperbarui.", true);

    } catch (e) {
      message("adminMessage", e.message);
    } finally {
      adminRefreshing = false;
    }
  }

  function startAdminPolling() {
    stopAdminPolling();

    adminPollId = setInterval(() => {
      if (adminToken) loadAdminDashboard();
    }, 5000);
  }

  function stopAdminPolling() {
    if (adminPollId) clearInterval(adminPollId);
    adminPollId = null;
  }

  $("refreshAdminBtn").addEventListener("click", () => {
    loadAdminDashboard();
  });

  // =========================================
  // KONTROL ADMIN
  // =========================================

  $("participantTableBody").addEventListener("click", async e => {
    const btn = e.target.closest("button[data-action]");

    if (!btn || adminBusy) return;

    const action = btn.dataset.action;
    const targetSession = btn.dataset.session;
    const subject = btn.dataset.subject;

    const names = {
      lock: "mengunci",
      unlock: "membuka kembali",
      finish: "mengakhiri"
    };

    const confirmation = {
      lock: "Yakin ingin mengunci ujian peserta ini?",
      unlock: "Yakin ingin membuka kembali ujian peserta ini?",
      finish: "Yakin ingin mengakhiri ujian peserta ini secara permanen?"
    };

    if (!confirm(confirmation[action])) return;

    adminBusy = true;
    btn.disabled = true;

    try {
      const result = await api(
        "admin" + action.charAt(0).toUpperCase() + action.slice(1),
        {
          adminToken,
          sessionToken: targetSession,
          subject
        }
      );

      message(
        "adminMessage",
        result.message || "Berhasil " + names[action] + " ujian.",
        true
      );

      await loadAdminDashboard();

    } catch (e) {
      message("adminMessage", e.message);
    } finally {
      adminBusy = false;
    }
  });

  // =========================================
  // LOGOUT ADMIN
  // =========================================

  $("adminLogoutBtn").addEventListener("click", async () => {
    if (!confirm("Logout dari Dashboard Admin?")) return;

    stopAdminPolling();

    try {
      await api("adminLogout", { adminToken });

      adminToken = "";
      show("loginView");

      message("loginMessage", "Logout Admin berhasil.", true);

    } catch (e) {
      message("adminMessage", e.message);
    }
  });

  // =========================================
  // PILIH MATA PELAJARAN
  // =========================================

  document.querySelectorAll(".startBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedSubject = btn.dataset.subject;

      $("subjectTitle").textContent =
        "Token " + cfg.subjects[selectedSubject].name;

      $("subjectToken").value = "";
      message("subjectMessage", "");

      show("subjectTokenView");
    });
  });

  $("backBtn").addEventListener("click", () => {
    show("dashboardView");
  });

  // =========================================
  // MULAI UJIAN
  // =========================================

  $("subjectTokenForm").addEventListener("submit", async e => {
    e.preventDefault();

    unlockAudio();

    const btn = e.submitter;
    btn.disabled = true;

    message("subjectMessage", "Memverifikasi token mata pelajaran...");

    try {
      const result = await api("startSubject", {
        sessionToken,
        subject: selectedSubject,
        subjectToken: $("subjectToken").value.trim()
      });

      deadline = Number(result.deadline);

      if (!result.formUrl || !Number.isFinite(deadline)) {
        throw new Error("Data ujian dari server tidak lengkap.");
      }

      $("examTitle").textContent = cfg.subjects[selectedSubject].name;
      $("examFrame").src = result.formUrl;

      $("lockedOverlay").classList.add("hidden");

      examActive = true;
      finishing = false;
      violationHandling = false;

      $("finishBtn").disabled = false;

      $("examNotice").textContent =
        "Jangan menutup halaman ujian atau berpindah tab. Aktivitas halaman akan dicatat oleh sistem.";

      $("examNotice").classList.remove("violation");

      $("examStatus").textContent =
        "Pastikan jawaban sudah dikirim melalui Google Form.";

      show("examView");

      startTimer();
      startStatusPolling();

      await logActivity(
        "UJIAN_DIMULAI",
        "Peserta membuka ujian."
      );

    } catch (e) {
      message("subjectMessage", e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // =========================================
  // FULLSCREEN
  // =========================================

  $("fullscreenBtn").addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (_) {
      $("examStatus").textContent =
        "Mode layar penuh tidak didukung atau tidak diizinkan browser.";
    }
  });

  document.addEventListener("fullscreenchange", () => {
    $("fullscreenBtn").textContent =
      document.fullscreenElement
        ? "Keluar Layar Penuh"
        : "Aktifkan Layar Penuh";

    if (examActive && !document.fullscreenElement) {
      handleViolation(
        "FULLSCREEN_DITUTUP",
        "Mode layar penuh ditutup.",
        "Ujian ditutup karena mode layar penuh dihentikan."
      );
    }
  });

  // =========================================
  // SELESAIKAN UJIAN
  // =========================================

  $("finishBtn").addEventListener("click", async () => {
    if (confirm(
      "Apakah Anda yakin ingin menyelesaikan ujian ini? Pastikan jawaban di Google Form sudah dikirim."
    )) {
      await finishExam(
        "SELESAI",
        "Peserta menekan tombol selesai."
      );
    }
  });

  $("dashboardBtn").addEventListener("click", () => {
    $("examFrame").src = "about:blank";

    stopTimer();
    stopStatusPolling();

    selectedSubject = "";
    examActive = false;

    show("dashboardView");
  });

  // =========================================
  // LOGOUT PESERTA
  // =========================================

  $("logoutBtn").addEventListener("click", async () => {
    if (!confirm("Logout dari sistem ujian?")) return;

    try {
      await api("logout", { sessionToken });

      sessionToken = "";
      selectedSubject = "";

      show("loginView");

    } catch (e) {
      message("dashboardMessage", e.message);
    }
  });

  // =========================================
  // DETEKSI PELANGGARAN
  // =========================================

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      handleViolation(
        "TAB_TIDAK_AKTIF",
        "Halaman ujian tidak terlihat.",
        "Ujian ditutup karena halaman berpindah atau tidak aktif."
      );
    }
  });

  // =========================================
  // CEGAH TIMER TERTINGGAL SAAT HALAMAN AKTIF KEMBALI
  // =========================================

  window.addEventListener("pageshow", () => {
    if (examActive) {
      checkParticipantStatus();
    }
  });

})();

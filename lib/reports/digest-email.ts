// Inline HTML renderer for the weekly digest. Keeping it dependency-free so
// we don't have to compile React Email templates server-side for one email.

import type { DigestData } from "./digest-data";
import type { PeppersPick } from "./peppers-pick";

const NAVY = "#1B2340";
const BANANA = "#FFCE3A";
const CREAM = "#FFF7E6";
const CREAM_2 = "#FFEEC9";
const WHITE = "#FFFEFA";
const CORAL = "#FF7A5C";
const LEAF = "#2FB67C";
const SLATE = "#6B6E85";

export function digestSubject(data: DigestData): string {
  const { total_calls, avg_score } = data.headline;
  if (total_calls === 0) return `Your Monday briefing — no team activity this week`;
  if (avg_score > 0)
    return `Your Monday briefing — ${total_calls} calls, ${avg_score}/10 team avg`;
  return `Your Monday briefing — ${total_calls} calls this week`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function deltaChip(delta: number, unit = "%"): string {
  if (delta === 0) return "";
  const up = delta > 0;
  const bg = up ? LEAF : CORAL;
  const arrow = up ? "▲" : "▼";
  return `<span style="background:${bg};color:white;border:1.5px solid ${NAVY};padding:2px 6px;border-radius:100px;font-size:11px;font-weight:700;margin-left:6px;">${arrow} ${Math.abs(delta)}${unit}</span>`;
}

function headlineCard(label: string, value: string, delta: string): string {
  return `
    <td style="padding:14px 12px;border:2.5px solid ${NAVY};border-radius:18px;background:${WHITE};width:33%;vertical-align:top;">
      <div style="font-size:10px;color:${NAVY};text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:6px;">${label}</div>
      <div style="font-size:28px;color:${NAVY};font-weight:700;line-height:1;font-family:Georgia,serif;">
        ${value}
      </div>
      <div style="margin-top:8px;">${delta}</div>
    </td>`;
}

const CAT_LABEL: Record<PeppersPick["category"], string> = {
  jump: "Score jump",
  drop: "Score drop",
  outlier: "Outlier",
  high_effort: "Long haul",
  callback: "Callback win",
};

const CAT_BG: Record<PeppersPick["category"], string> = {
  jump: LEAF,
  drop: CORAL,
  outlier: BANANA,
  high_effort: CREAM_2,
  callback: "#D4EEF5",
};

const CAT_FG: Record<PeppersPick["category"], string> = {
  jump: "white",
  drop: "white",
  outlier: NAVY,
  high_effort: NAVY,
  callback: NAVY,
};

function pickCard(pick: PeppersPick, appUrl: string): string {
  const mins = Math.round(pick.duration_seconds / 60);
  const url = `${appUrl}/?log=${pick.call_log_id}`;
  const score =
    typeof pick.ai_score === "number"
      ? `<span style="background:${WHITE};border:1.5px solid ${NAVY};padding:2px 8px;border-radius:100px;font-size:11px;font-weight:700;color:${NAVY};">${pick.ai_score.toFixed(1)}/10</span>`
      : "";
  return `
    <td style="padding:14px;border:2.5px solid ${NAVY};border-radius:14px;background:${CREAM};vertical-align:top;">
      <div style="display:block;margin-bottom:8px;">
        <span style="background:${CAT_BG[pick.category]};color:${CAT_FG[pick.category]};border:1.5px solid ${NAVY};padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">${CAT_LABEL[pick.category]}</span>
        ${score}
      </div>
      <div style="font-size:15px;color:${NAVY};font-weight:600;line-height:1.35;margin-bottom:6px;font-family:Georgia,serif;">
        ${escapeHtml(pick.pepper_headline)}
      </div>
      <div style="font-size:12px;color:${NAVY};line-height:1.5;margin-bottom:10px;">
        ${escapeHtml(pick.pepper_reason)}
      </div>
      <div style="font-size:11px;color:${SLATE};">
        <strong style="color:${NAVY};">${escapeHtml(pick.rep_name)}</strong> → ${escapeHtml(pick.prospect_number)} · ${mins}m
      </div>
      <a href="${url}" style="display:inline-block;margin-top:10px;background:${BANANA};border:2px solid ${NAVY};color:${NAVY};padding:6px 14px;border-radius:100px;font-size:12px;font-weight:700;text-decoration:none;">▶ Listen</a>
    </td>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderDigestHtml(data: DigestData, appUrl: string): string {
  const { headline, picks, top_performer, coaching_opportunity } = data;

  const picksRow =
    picks.length > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="8" border="0" style="margin:10px 0;">
          <tr>
            ${picks.slice(0, 3).map((p) => pickCard(p, appUrl)).join("")}
            ${picks.length < 3 ? '<td style="width:33%;"></td>'.repeat(3 - picks.length) : ""}
          </tr>
        </table>`
      : `<p style="color:${SLATE};font-size:14px;">Nothing stood out this week — a quiet one.</p>`;

  const topPerformerBlock = (() => {
    if (!top_performer.score && !top_performer.volume) return "";
    const parts: string[] = [];
    if (top_performer.score)
      parts.push(
        `<strong style="color:${NAVY};">${escapeHtml(top_performer.score.name)}</strong> leads on score at <strong>${top_performer.score.avg_score}/10</strong>`
      );
    if (top_performer.volume)
      parts.push(
        `<strong style="color:${NAVY};">${escapeHtml(top_performer.volume.name)}</strong> leads on volume with <strong>${top_performer.volume.total_calls}</strong> calls`
      );
    return `<div style="padding:16px;border:2.5px solid ${NAVY};border-radius:14px;background:${CREAM_2};margin:12px 0;">
      <div style="font-size:11px;color:${NAVY};text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:6px;">Top performers</div>
      <div style="font-size:13px;color:${NAVY};line-height:1.6;">${parts.join("<br />")}</div>
    </div>`;
  })();

  const coachingBlock = coaching_opportunity
    ? `<div style="padding:16px;border:2.5px solid ${NAVY};border-radius:14px;background:${WHITE};margin:12px 0;">
        <div style="font-size:11px;color:${NAVY};text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:6px;">Coaching opportunity</div>
        <div style="font-size:13px;color:${NAVY};line-height:1.5;">${escapeHtml(coaching_opportunity)}</div>
      </div>`
    : "";

  const dateRange = `${fmtDate(data.period_start)} – ${fmtDate(data.period_end)}`;

  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin:0;padding:0;background:${CREAM};font-family:'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};">
      <tr>
        <td align="center" style="padding:30px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
            <tr>
              <td style="padding:0 0 20px 0;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <span style="background:${BANANA};border:2.5px solid ${NAVY};width:42px;height:42px;border-radius:12px;display:inline-block;text-align:center;line-height:42px;">🌶️</span>
                  <div>
                    <div style="font-size:22px;color:${NAVY};font-weight:700;font-family:Georgia,serif;">Pepper</div>
                    <div style="font-size:11px;color:${SLATE};text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">Your Monday morning briefing</div>
                  </div>
                </div>
                <div style="margin-top:10px;font-size:12px;color:${SLATE};">${dateRange}</div>
              </td>
            </tr>

            <tr><td style="padding:10px 0 4px 0;font-size:11px;color:${NAVY};text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">This week</td></tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="8" border="0">
                  <tr>
                    ${headlineCard("Total calls", headline.total_calls.toLocaleString(), deltaChip(headline.total_calls_delta))}
                    ${headlineCard("Answer rate", headline.answer_rate + "%", deltaChip(headline.answer_rate_delta, "pp"))}
                    ${headlineCard("Avg AI score", headline.avg_score ? headline.avg_score.toFixed(1) + "/10" : "—", deltaChip(headline.avg_score_delta, "pts"))}
                  </tr>
                </table>
              </td>
            </tr>

            <tr><td style="padding:18px 0 4px 0;font-size:11px;color:${NAVY};text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">Pepper&rsquo;s Pick</td></tr>
            <tr><td style="font-size:12px;color:${SLATE};padding-bottom:4px;">Calls worth your 5 minutes this week</td></tr>
            <tr><td>${picksRow}</td></tr>

            <tr><td>${topPerformerBlock}</td></tr>
            <tr><td>${coachingBlock}</td></tr>

            <tr>
              <td style="padding:24px 0 8px 0;font-size:11px;color:${SLATE};text-align:center;">
                Adjust preferences in <a href="${appUrl}/settings" style="color:${NAVY};text-decoration:underline;">Pepper → Settings → Email</a>.
              </td>
            </tr>
            <tr>
              <td style="padding:4px 0 10px 0;font-size:10px;color:${SLATE};text-align:center;">
                Sent by Pepper · <a href="${appUrl}" style="color:${SLATE};">${appUrl.replace(/^https?:\/\//, "")}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

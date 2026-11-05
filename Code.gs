/**
 * Vendor Mail Sender - Innovatiview India Ltd.
 * Backend (Google Apps Script)
 *
 * DEPLOYMENT (see appsscript.json):
 *   Execute as : User accessing the web app
 *   Who has access : Anyone with Google account
 *
 * LOGIN
 *  - No OTP. The user is identified by the Google account they are signed in with.
 *  - @innovatiview.in and @innovatiview.com are allowed automatically.
 *  - Any other Google account must be listed in the "Allowed Users" tab of the audit sheet.
 *  - Every mail is sent from the logged-in user's own account (BCC audit copy goes to BCC_AUDIT_EMAIL).
 *
 * AUDIT SHEET
 *  - One fixed Google Sheet (AUDIT_SS_ID). Every user needs Editor access to it.
 *
 * RATES
 *  - A vendor with more than one rate (State / City wise) can enter them separated by "|",
 *    e.g.  Delhi: 400/600 | UP: 350/500   - the mail shows each rate on a separate line.
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Vendor Mail Sender - Innovatiview')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

var AUDIT_SS_ID = "11Y7Qm3JxLA4a6bYLh1Llt3U2Iy3xJBEBGjV0VLTl5nw";
var ALLOWED_DOMAINS = ["innovatiview.in", "innovatiview.com"];
var BCC_AUDIT_EMAIL = "sandeep.raghav@innovatiview.in";
var SESSION_VALIDITY_SECONDS = 6 * 60 * 60; // login session 6 hours (CacheService maximum)
var LOG_TIMEZONE = "Asia/Kolkata";

var ZM_DETAILS = {
  "Girish":   { name: "Girish Chandra Tiwari", email: "girish.tiwari@innovatiview.com",  phone: "8448786844" },
  "Devendra": { name: "Devendra Bose",         email: "devendra.bose@innovatiview.com",  phone: "9289035157" },
  "Chetan":   { name: "Chetan Pandey",         email: "chetan.pandey@innovatiview.com",  phone: "9910621078" },
  "Monu":     { name: "Monu Kumar",            email: "monu.kumar@innovatiview.com",     phone: "9582091469" },
  "Amarjeet": { name: "An Amarjeet",           email: "amarjeet@innovatiview.com",       phone: "8750858591" }
};

var LOG_HEADERS = {
  "Login Audit": ["Timestamp", "Login Mail ID", "Status"],
  "Dispatch Audit": [
    "Timestamp", "Sender Mail ID", "Vendor Name", "Vendor Mail ID", "ZM Assigned", "Rate (Shift)", "CC", "Subject", "Status", "Details",
    "Service", "Exam Name", "Exam Date", "Project Code", "Training", "Enclosure", "Mock", "Reporting Time",
    "Attachment Format", "Center Rows", "seQRview Rows", "seQRview Attached",
    "Operator List Date", "Final Operator Date", "CSR Submit Date"
  ],
  "Vendor Memory": ["Vendor Name", "Email", "Shift", "Training", "Enclosure", "Mock", "Reporting Time", "CC", "ZM", "Updated At"],
  "Allowed Users": ["Email", "Added By", "Added On"]
};

// ---------------------------------------------------------------------------
// MASTER AUDIT SPREADSHEET (ONE FIXED FILE, ALL TABS)
// ---------------------------------------------------------------------------

function getMasterAuditSpreadsheet_() {
  return SpreadsheetApp.openById(AUDIT_SS_ID);
}

function getLogSheet_(sheetName) {
  var ss = getMasterAuditSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  var headers = LOG_HEADERS[sheetName];

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    }
    sheet.setFrozenRows(1);
  } else if (headers && sheet.getLastColumn() < headers.length) {
    // Existing sheet: add the new header columns (old data is not disturbed)
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function nowStr_() {
  return Utilities.formatDate(new Date(), LOG_TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

// Appends a row in text format (so Sheets does not auto-convert time / amount values)
function appendTextRow_(sheet, row) {
  var r = sheet.getLastRow() + 1;
  var range = sheet.getRange(r, 1, 1, row.length);
  range.setNumberFormat('@');
  range.setValues([row]);
}

// ---------------------------------------------------------------------------
// AUTHENTICATION (GOOGLE ACCOUNT LOGIN, LOGIN LOG, SESSION CHECK)
// ---------------------------------------------------------------------------

function logLogin_(email, status) {
  try {
    var sheet = getLogSheet_("Login Audit");
    appendTextRow_(sheet, [nowStr_(), email, status || "SUCCESS"]);
  } catch (e) {}
}

// Returns the email for a session token; throws an error if the token is invalid or expired.
// Every successful call renews the session for another 6 hours (sliding session).
function requireAuth_(token) {
  var cache = CacheService.getScriptCache();
  var email = token ? cache.get('sess:' + token) : null;
  if (!email) {
    throw new Error("Session expired. Please refresh the page and login again.");
  }
  cache.put('sess:' + token, email, SESSION_VALIDITY_SECONDS);
  return email;
}

function checkSession(token) {
  try {
    var email = requireAuth_(token);
    return { valid: true, email: email };
  } catch (e) {
    return { valid: false };
  }
}

function isAllowedUser_(email) {
  var domain = email.split("@")[1] || "";
  if (ALLOWED_DOMAINS.indexOf(domain) !== -1) return true;
  var data = getLogSheet_("Allowed Users").getDataRange().getDisplayValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email) return true;
  }
  return false;
}

// Called by the page on load. Identifies the signed-in Google account and opens a session.
function autoLogin() {
  var url = "";
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}

  var email = "";
  try { email = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase(); } catch (e) {}
  if (!email) {
    try { email = String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase(); } catch (e) {}
  }
  if (!email) {
    return { success: false, url: url, message: "Could not identify your Google account. Please sign in with a Google account." };
  }

  try {
    getMasterAuditSpreadsheet_(); // access check: every user needs Editor access to the audit sheet
  } catch (e) {
    return { success: false, url: url, message: email + " does not have access to the audit sheet. Please ask the admin (Jatin Arya) to give you access." };
  }

  try {
    if (!isAllowedUser_(email)) {
      logLogin_(email, "FAILED - not in allowed list");
      return { success: false, url: url, message: email + " is not authorized. Please ask the admin to add you to the Allowed Users tab." };
    }
  } catch (e) {
    return { success: false, url: url, message: "Unable to verify access. Please try again." };
  }

  var token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('sess:' + token, email, SESSION_VALIDITY_SECONDS);
  logLogin_(email, "SUCCESS");
  return { success: true, token: token, email: email, url: url };
}

function logout(token) {
  try {
    if (token) CacheService.getScriptCache().remove('sess:' + token);
  } catch (e) {}
  return true;
}

// ---------------------------------------------------------------------------
// VENDOR MEMORY (AUTO-FILL & SHEET TAB SYNC)
// ---------------------------------------------------------------------------

// Loads the memory of all vendors in a single call. Key = vendor name (lowercase, trimmed)
function getVendorMemoryBulk(names, token) {
  try {
    requireAuth_(token);
    var wanted = {};
    (names || []).forEach(function (n) {
      var k = String(n || "").trim().toLowerCase();
      if (k) wanted[k] = true;
    });

    var sheet = getLogSheet_("Vendor Memory");
    var data = sheet.getDataRange().getDisplayValues();
    var out = {};

    for (var i = 1; i < data.length; i++) {
      var key = String(data[i][0]).trim().toLowerCase();
      if (!key || !wanted[key]) continue;
      out[key] = {
        vendor_name: data[i][0],
        email: data[i][1],
        shift: data[i][2],
        training: data[i][3],
        enclosure: data[i][4],
        mock: data[i][5],
        reporting_time: data[i][6],
        cc: data[i][7],
        zm: data[i][8]
      };
    }
    return out;
  } catch (e) {
    return {};
  }
}

function getVendorMemory(vendorName, token) {
  try {
    requireAuth_(token);
    var vClean = String(vendorName || "").trim().toLowerCase();
    if (!vClean) return null;
    var all = getVendorMemoryBulk([vendorName], token);
    return all[vClean] || null;
  } catch (e) {
    return null;
  }
}

function saveVendorMemory(payload) {
  try {
    var vName = String(payload.vendor_name || "").trim();
    if (!vName) return;

    var sheet = getLogSheet_("Vendor Memory");
    var data = sheet.getDataRange().getDisplayValues();
    var foundRow = -1;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim().toLowerCase() === vName.toLowerCase()) {
        foundRow = i + 1;
        break;
      }
    }

    var rowValues = [
      vName,
      payload.vendor_mail || "",
      payload.shift || "",
      payload.training || "",
      payload.enclosure || "",
      payload.mock || "",
      payload.reporting_time || "",
      payload.cc || "",
      payload.zm_select || "",
      nowStr_()
    ];

    if (foundRow > 0) {
      // Training / Enclosure: if blank this time (different service), keep the old value
      var old = data[foundRow - 1];
      if (!rowValues[3] && old[3]) rowValues[3] = old[3];
      if (!rowValues[4] && old[4]) rowValues[4] = old[4];
      var range = sheet.getRange(foundRow, 1, 1, rowValues.length);
      range.setNumberFormat('@');
      range.setValues([rowValues]);
    } else {
      appendTextRow_(sheet, rowValues);
    }
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function esc_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Multiple rates separated by "|" (or a new line) are shown on separate lines in the mail
function rateCellHtml_(val) {
  var parts = String(val || "").split(/\s*[|\n]\s*/).filter(Boolean);
  if (!parts.length) return "N/A";
  return parts.map(esc_).join("<br>");
}

function formatInputDate_(value) {
  if (!value) return "";
  var s = String(value).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var monthName = months[parseInt(m[2], 10) - 1];
  if (!monthName) return s;
  return m[3] + " " + monthName + " " + m[1];
}

function isValidEmail_(email) {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(email || "").trim());
}

function parseEmailList_(text) {
  var out = { valid: [], invalid: [] };
  String(text || "").split(/[,;\n]+/).forEach(function (part) {
    var e = part.trim();
    if (!e) return;
    if (isValidEmail_(e)) out.valid.push(e); else out.invalid.push(e);
  });
  return out;
}

function safeFileName_(name) {
  var s = String(name || "Vendor")
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]+/g, " ")
    .replace(/[\\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  if (s.length > 80) s = s.substring(0, 80).replace(/[. ]+$/, "");
  return s || "Vendor";
}

function toCsv_(rows) {
  return rows.map(function (row) {
    return row.map(function (cell) {
      var s = String(cell == null ? "" : cell);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",");
  }).join("\r\n");
}

// Makes all rows the same width (rectangular)
function padRows_(rows) {
  var width = 0;
  rows.forEach(function (r) { if (r.length > width) width = r.length; });
  return rows.map(function (r) {
    var copy = r.slice();
    while (copy.length < width) copy.push("");
    return copy;
  });
}

function generateSubject(data) {
  var service = data.service || "Biometric";
  var exam = data.exam_name || "EXAM";
  var code = data.project_code ? "[" + data.project_code + "] " : "";
  var date = data.exam_date ? "(" + data.exam_date + ")" : "";
  return code + "Deployment and Duty Guidelines for " + exam + " " + date + " - " + service;
}

function getDispatchQuota(token) {
  requireAuth_(token);
  return MailApp.getRemainingDailyQuota();
}

// ---------------------------------------------------------------------------
// MAIL BODIES (FRISKING & BIOMETRIC)
// ---------------------------------------------------------------------------

function buildMailHtmlBody(payload) {
  var zmKey = payload.zm_select || "Girish";
  var zmInfo = ZM_DETAILS[zmKey] || ZM_DETAILS["Girish"];
  var service = payload.service || "Biometric";

  var examDateStr = esc_(payload.exam_date || "");
  var reportingTimeStr = esc_(payload.reporting_time || "");
  var opListDate = esc_(formatInputDate_(payload.operator_list_date));
  var finOpDate = esc_(formatInputDate_(payload.final_operator_date));
  var csrDate = esc_(formatInputDate_(payload.csr_submit_date));
  var singleDouble = rateCellHtml_(payload.shift);
  var trainingAmt = rateCellHtml_(payload.training);
  var mockAmt = rateCellHtml_(payload.mock);
  var enclosureAmt = rateCellHtml_(payload.enclosure);

  // Extra note / instructions: yellow highlighted block right below "Dear Concern,"
  var customNotesHtml = (payload.custom_notes_check && payload.custom_notes)
    ? esc_(payload.custom_notes).replace(/\r?\n/g, "<br>")
    : "";
  var customBlock = customNotesHtml
    ? '<table cellpadding="8" cellspacing="0" style="border-collapse:collapse; width:100%; margin:10px 0;"><tr><td bgcolor="#FFFF00" style="background-color:#FFFF00; color:#000000; font-weight:bold;">' + customNotesHtml + '</td></tr></table>'
    : "";

  var escalationHtml = `
    <p style="margin:0 0 4px 0;">In case of any issue, please escalate as per the matrix below:</p>
    <ul style="margin:0 0 12px 0; padding-left:20px;">
        <li>Zonal Manager: ${zmInfo.name} - <a href="mailto:${zmInfo.email}">${zmInfo.email}</a> / <a href="tel:+91${zmInfo.phone}">${zmInfo.phone}</a></li>
        <li>Department Head: Vishal Kaushik - <a href="mailto:vishal.kaushik@innovatiview.com">vishal.kaushik@innovatiview.com</a> / <a href="tel:+918384058706">8384058706</a></li>
    </ul>
  `;

  // ======================= FRISKING TEMPLATE =======================
  if (service === "Frisking") {
    return `
      <div class="email-container" style="font-family: Arial, sans-serif; font-size: 14px; color: #000; max-width: 100%; line-height: 1.6;">

    <p>Dear Concern,</p>

    ${customBlock}

    <p>We are happy to engage your services for the upcoming exam on <b>${examDateStr}</b> as per the attached Excel file.</p>

    <table border="1" cellpadding="8" cellspacing="0"
        style="border-collapse:collapse; width:500px; margin-bottom:16px;">
        <tr>
            <td style="width:200px; background:#f0f4ff; color:#1a56db; font-weight:bold;">Exam Date</td>
            <td style="font-weight:bold;">${examDateStr}</td>
        </tr>
        <tr>
            <td style="background:#f0f4ff; color:#1a56db; font-weight:bold;">Reporting Time</td>
            <td>${reportingTimeStr}</td>
        </tr>
        <tr>
            <td style="background:#f0f4ff; color:#1a56db; font-weight:bold;">Mock Day</td>
            <td>As per ops team</td>
        </tr>
    </table>

    <h2 style="font-size:15px; font-weight:bold; margin:18px 0 10px 0; border-bottom:1px solid #ccc; padding-bottom:4px;">KEY POINTS</h2>

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">1. Guards Details Submission</h3>
    <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li>Submit the complete list of guards, along with Mobile Number &amp; Aadhaar Number for all guards, by <b>${opListDate}</b></li>
        <li>All guards must be 22 years of age or above</li>
    </ul>

    <p style="font-weight:bold; margin:10px 0 4px 0;">Strict Action:</p>
    <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li>If any guard under 22 years of age is found, disciplinary action will follow.</li>
        <li>No manpower should be hired from the center (5x penalties will apply).</li>
        <li>No changes in the guards list will be accepted after <b>${finOpDate}</b>. Entry to the center will be denied on exam day if alternate manpower arrives instead, and a 2× penalty will be imposed for each center in violation.</li>
    </ul>

    <p style="font-weight:bold; margin:10px 0 4px 0;">Mandatory:</p>
    <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li>✔ Align only seQRview onboarded manpower (list attached)</li>
        <li>✔ Opsview is mandatory for reporting, and all operational tasks must be performed and updated in Opsview</li>
        <li>✔ Watch the interactive training video - it will be shared by the Ops team in the vendors' group.</li>
    </ul>
    <p style="margin:4px 0 8px 20px;">🔗 <a href="https://link.seqrview.com/" target="_blank">https://link.seqrview.com/</a></p>

    <p style="font-weight:bold; margin:10px 0 4px 0;">Additional Penalties:</p>
    <ul style="margin:0 0 12px 0; padding-left:20px; color:red; font-weight:bold;">
        <li>Underage manpower → Complete center payment deduction</li>
        <li>seQRview not onboarded manpower → Rs 250 deduction for 2 shifts and Rs 150 deduction for a single shift</li>
        <li>Sleeper on duty → Double deduction per guard</li>
        <li>100% center deduction if a fake or edited selfie is shared.</li>
    </ul>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">2. Attendance and Timings</h3>
    <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li><b>Attendance is mandatory</b> and must be marked via a <b>selfie</b> with GEO tagging, posted in the designated WhatsApp group.</li>
        <li><b>Adherence to timing</b> is crucial. Any delay or deviation will attract penalties.</li>
        <li>Share <b>two group selfies with geo-tagging:</b>
            <ul style="padding-left:18px; margin-top:4px;">
                <li>On arrival at the center</li>
                <li>After the exam concludes</li>
            </ul>
        </li>
    </ul>
    <p style="margin:4px 0 12px 0;">Please refer to the <b>Deduction Terms</b> and <b>Scope of Work</b> documents for details.</p>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">3. Dress Code and Documentation</h3>
    <p style="margin:0 0 8px 0;">All security guards must be properly dressed in the prescribed uniform. This includes formal shoes and the jacket provided by Innovatiview, which must be worn on the exam day.</p>

    <p style="font-weight:bold; margin:10px 0 4px 0;">Mandatory Documents to Carry:</p>
    <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li>Government-issued ID proof</li>
        <li>Authority letter</li>
        <li>Innovatiview ID card</li>
    </ul>

    <p style="color:red; font-weight:bold; margin:8px 0 12px 0;">
        Note: Strict action and penalties will be enforced in case of any dress code violation. Guards are strictly prohibited from wearing slippers, lower wear, or any inappropriate attire while on duty.
    </p>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">4. Attendance Malpractice</h3>
    <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li>It has come to our notice that <b>selfies are being shared even when the guard is not present at the center</b>.</li>
        <li>Submission of edited or fake selfies is strictly prohibited and <b>may lead to deduction</b>.</li>
        <li>This is <b>strictly against policy</b> and may lead to <b>penalties</b> or even <b>blacklisting</b> of your vendor profile.</li>
        <li>Guards must <b>not leave the center before 5:30 PM</b>. Any violation will result in penalties.</li>
    </ul>
    <p style="color:red; font-weight:bold; margin:8px 0 12px 0;">
        If any of the above issues are found, the full center payment will be deducted.
    </p>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">5. CSR Feedback Form</h3>
    <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li>The Feedback Report, signed by both the Observer and the Center SPOC, must be uploaded to the portal via the application and also shared in the WhatsApp group on the same day, no later than 7 PM on ${examDateStr}, with proper signature and stamp on the feedback report.</li>
        <li>The hard copy of the CSR must be dispatched no later than ${csrDate} EOD, with proper signature and stamp on each CSR.</li>
        <li style="color:red; font-weight:bold;">The second advance will not be initiated unless 95% of the CSRs have been received from the vendor.</li>
    </ul>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">6. Material Checklist (To be Verified on Mock Day)</h3>
    <p style="margin:0 0 6px 0;">Materials will be dispatched directly to the respective centers. Security guards are required to verify and confirm the material count on the mock day as per the prescribed format.</p>
    <p style="margin:0 0 6px 0;">The materials are as follows:</p>
    <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li><b>Banners</b> (to be placed at the entry gate)</li>
        <li>Hand Held Metal Detector (HHMD)</li>
        <li><b>Enclosure</b>/partition for female frisking</li>
        <li><b>Extra batteries</b> (for HHMD or other devices)</li>
        <li><b>ID cards</b> (for all staff/guards)</li>
    </ul>

    <p style="margin:8px 0;"><b>After the exam is completed, all materials sent by Innovatiview must be properly repacked. A formal handover–takeover process must be conducted at the center with the Center Head once packing is finished and the materials are submitted.</b></p>

    <p style="font-weight:bold; margin:10px 0 4px 0;">Ensure the following during the sign-off process:</p>
    <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li>The <b>name and contact number</b> must be clearly mentioned on the <b>handover/takeover form</b>, along with the <b>duly signed and official stamp</b> of the Center Head.</li>
        <li>The exact quantity of materials must be recorded, either as per the count shared by the team or based on the actual materials counted during mock activities or final verification.</li>
    </ul>

    <p style="color:red; font-weight:bold; margin:8px 0 4px 0;">Any discrepancy will lead to deductions based on the missing material quantity, including:</p>
    <ul style="margin:0 0 12px 0; padding-left:20px;">
        <li>Handover/takeover form not provided by the vendor</li>
        <li>Incorrect or lesser quantity mentioned</li>
        <li>Any overwriting or cutting on the form</li>
        <li>Submission of fake or invalid forms</li>
    </ul>

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">VENDOR AGREEMENT</h3>
    <p style="margin:0 0 6px 0;">We have sent you a hard copy of the vendor agreement, along with an e-sign link via email. Kindly either e-sign the document or sign/stamp the hard copy you receive, and share a soft copy with us.</p>
    <p style="font-weight:bold; margin:0 0 12px 0;">Please note that if this is not completed, the work order will be cancelled.</p>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">POLICE VERIFICATION</h3>
    <p style="margin:0 0 6px 0;">A police clearance certificate is mandatory for vendors and their city coordinators. Please upload it using the portal link below. The certificate must not be dated more than 6 months before ${examDateStr}.</p>
    <ul style="margin:0 0 8px 0; padding-left:20px;">
        <li><b>For GST firms, a notarized declaration is applicable (draft attached below).</b></li>
        <li><b>For non-GST firms, police verification is mandatory.</b></li>
    </ul>
    <p style="margin:4px 0;">🔗 <b>Link to apply for police verification:</b><br>
    <a href="https://digitalpolice.gov.in" target="_blank">digitalpolice.gov.in</a></p>
    <p style="margin:4px 0 12px 0;">🔗 <b>Portal link to upload:</b><br>
    <a href="https://script.google.com/a/macros/innovatiview.com/s/AKfycby9lSJnDWEUJirMqY3mrewaq9oUYqwaeJdIqcGcV-DBxwSwUn8LcftUgysKLRLXMPDMA/exec" target="_blank">https://script.google.com/a/macros/innovatiview.com/s/AKfycby9lSJnDWEUJirMqY3mrewaq9oUYqwaeJdIqcGcV-DBxwSwUn8LcftUgysKLRLXMPDMA/exec</a></p>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">7. Deductions &amp; Penalties</h3>
    <table border="1" cellpadding="8" cellspacing="0"
        style="border-collapse:collapse; width:100%; max-width:600px; margin-bottom:14px; font-size:13px;">
        <thead>
            <tr style="background:#f0f0f0; font-weight:bold;">
                <th style="width:40%; text-align:left; padding:8px;">Reason</th>
                <th style="width:15%; text-align:left; padding:8px;">Services</th>
                <th style="width:45%; text-align:left; padding:8px;">Amount</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td rowspan="2" style="padding:8px;">Late for Exam Day (per Guard)</td>
                <td style="padding:8px;">Frisking</td>
                <td style="padding:8px;">25% (if reported after 30 mins of reporting time)</td>
            </tr>
            <tr>
                <td style="padding:8px;">Frisking</td>
                <td style="padding:8px;">50% (if reported after 1 hour of reporting time)</td>
            </tr>
            <tr>
                <td style="padding:8px;">Absent for Exam Day</td>
                <td style="padding:8px;">Frisking</td>
                <td style="padding:8px;">200% per guard</td>
            </tr>
            <tr>
                <td colspan="3" style="padding:8px; font-weight:bold;">Device Broken / Not Returned (per device)</td>
            </tr>
            <tr>
                <td style="padding:8px;">Jacket Loss (if provided by Innovatiview)</td>
                <td style="padding:8px;">Common</td>
                <td style="padding:8px;">500 INR</td>
            </tr>
            <tr>
                <td style="padding:8px;">HHMD Loss</td>
                <td style="padding:8px;">Frisking</td>
                <td style="padding:8px;">1000 INR</td>
            </tr>
            <tr>
                <td style="padding:8px;">Frisking Enclosure Loss</td>
                <td style="padding:8px;">Frisking</td>
                <td style="padding:8px;">1500 INR</td>
            </tr>
            <tr>
                <td style="padding:8px;">Banner Loss</td>
                <td style="padding:8px;">Frisking</td>
                <td style="padding:8px;">200 INR</td>
            </tr>
        </tbody>
    </table>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">8. Attachments</h3>
    <ol style="margin:0 0 12px 0; padding-left:20px;">
        <li>Frisking SOP</li>
        <li>Feedback Report / CSR (to be shared later)</li>
        <li>Deduction Terms</li>
        <li>Bank Details Format</li>
        <li>Material Handover Format</li>
        <li>Center-wise Details</li>
        <li>Vendor Agreement</li>
        <li>seQRview video</li>
        <li>Interactive video</li>
    </ol>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">9. Commercials</h3>
    <table border="1" cellpadding="8" cellspacing="0"
        style="border-collapse:collapse; width:300px; margin-bottom:12px; font-size:13px;">
        <thead>
            <tr style="background:#f0f0f0; font-weight:bold;">
                <th style="text-align:left; padding:8px;">Service</th>
                <th style="text-align:left; padding:8px;">Rate (INR)</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td style="padding:8px;">Single Shift / Double Shift</td>
                <td style="padding:8px;">${singleDouble}</td>
            </tr>
            <tr>
                <td style="padding:8px;">Mock (Supervisor Only)</td>
                <td style="padding:8px;">${mockAmt}</td>
            </tr>
            <tr>
                <td style="padding:8px;">Enclosure</td>
                <td style="padding:8px;">${enclosureAmt}</td>
            </tr>
        </tbody>
    </table>
    <p style="margin:0 0 12px 0;"><b>Note:</b> For any additional amount, prior written approval from the Vendor Manager is mandatory. No extra charges will be reimbursed without approval.</p>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">10. Payment Terms</h3>
    <p style="margin:0 0 4px 0;">Following the confirmation mail, payment will be processed in 3 stages:</p>
    <ul style="margin:0 0 12px 0; padding-left:20px;">
        <li>40% Advance – 1 day before the exam</li>
        <li>30% Post material pickup and 95% CSR submission (4 to 10 days after the exam)</li>
        <li>30% After receipt of material at the Delhi Warehouse (60 to 75 days after the exam)</li>
    </ul>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">11. GST &amp; Invoicing</h3>
    <ul style="margin:0 0 12px 0; padding-left:20px;">
        <li>If GST billing is applicable, mention this in your account details and in your response email.</li>
        <li>Share the hard copy of the bill only after full payment (excluding GST) is received.</li>
        <li>Complete the necessary processes on the GST portal after dispatch.</li>
        <li>GST payment is processed monthly between the 25th and 30th, subject to:
            <ul style="padding-left:18px; margin-top:4px;">
                <li>Receipt of the hard copy at the Noida Office</li>
                <li>Completion reflected on the GST portal</li>
            </ul>
        </li>
    </ul>

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">12. Escalation Matrix</h3>
    ${escalationHtml}

    <hr style="border:none; border-top:1px solid #ccc; margin:16px 0;">

    <h3 style="font-size:14px; font-weight:bold; margin:14px 0 6px 0;">13. Notes</h3>

    <p><b>Action Required:</b></p>
    <p style="margin:0 0 6px 0;">Please read all enclosed documents carefully and share your acceptance and required details at the earliest. For any clarification, feel free to reach out.</p>
    <p style="margin:0 0 12px 0;">In the absence of a response within two business days of receipt of this email, it shall be treated as an automatic acknowledgment (auto acceptance).</p>

    <p style="color:red; font-weight:bold; border:1px solid red; padding:10px; margin:12px 0;">
        Note:<br><br>
        Please note that the vendor shall be held fully responsible for any malpractice, misconduct, impersonation, or any other unauthorized activity carried out by any employee or operator deployed by them during the examination process. In such cases, strict legal action shall be initiated against both the vendor and the concerned operator/employee, and the vendor may also be blacklisted from future engagements.
    </p>

    <br><br>

    <p>
        Regards,<br>
        Operations Team
    </p>

</div>`;
  }

  // ======================= BIOMETRIC TEMPLATE =======================
  return `
      <div style="font-family: Arial, sans-serif; font-size:13px; line-height:1.6; color:#000;">

      <p>Dear Concern,</p>

      ${customBlock}

      <p>
      We are happy to engage your services for the upcoming exam on
      <b>${examDateStr}</b> as per the attached Excel file.
      </p>

      <table border="1" cellpadding="8" cellspacing="0"
      style="border-collapse:collapse; width:500px;">

      <tr>
      <td><b>Exam Date</b></td>
      <td>${examDateStr}</td>
      </tr>

      <tr>
      <td><b>Reporting Time</b></td>
      <td>${reportingTimeStr}</td>
      </tr>

      <tr>
      <td><b>Mock Day</b></td>
      <td>As per ops team</td>
      </tr>

      </table>

      <br>

      <h3>TRAINING PAYMENT CONDITIONS</h3>

      <p>
      From now onwards, the training amount will be paid only if all the following conditions are fulfilled:
      </p>

      <ul>

      <li>✔ The operator is 100% seQRview onboarded</li>

      <li>✔ The operator has watched the interactive training video</li>

      <li>✔ The same approved manpower is deployed on the exam day as per the shared list</li>

      </ul>

      <p style="color:red; font-weight:bold;">
      ❌ If any of the above conditions are not met, the training amount for that operator will not be paid.
      </p>

      <br>

      <h3>KEY POINTS</h3>

      <h4>1. Operator Details Submission</h4>

      <ul>

      <li>
      Submit the complete list of Operator Name, Mobile Number &amp; Aadhaar Number for all operators by <b>${opListDate}</b>
      </li>

      <li>
      All operators must be 21 years of age or above
      </li>

      </ul>

      <p><b>Strict Action:</b></p>

      <ul>

      <li>
      If any operator under 20 years of age is found, the full center payment will be withheld and disciplinary action will follow
      </li>

      <li>
      No manpower should be hired from the center (5x penalties will apply)
      </li>

      <li>
      No changes in the operator list will be accepted after <b>${finOpDate}</b>.
      Entry to the center will be denied on exam day if alternate manpower arrives instead,
      and a 2× penalty will be imposed for each center in violation.
      </li>

      </ul>

      <p><b>Mandatory:</b></p>

      <ul>

      <li>Align only seQRview onboarded manpower (list attached)</li>
      <li>Opsview is mandatory for reporting, and all operational tasks must be performed and updated in Opsview</li>

      <li>Watch the interactive training video - it will be shared by the Ops team in the vendors' group</li>

      </ul>

      <p>
      🔗
      <a href="https://link.seqrview.com/">
      https://link.seqrview.com/
      </a>
      </p>

      <p style="color:red;">

      <b>Additional Penalties:</b><br><br>

      - Underage manpower → Full payment deduction<br>
      - seQRview not onboarded manpower → Rs 250 deduction for 2 shifts and Rs 150 deduction for a single shift<br>
      - Sleeper on duty → Double deduction

      </p>

      <br>

      <h4>2. Attendance and Timings</h4>

      <ul>

      <li>
      Attendance is mandatory and must be marked via a selfie with GEO tagging, posted in the designated WhatsApp group.
      </li>

      <li>
      Adherence to timing is crucial. Any delay or deviation will attract penalties.
      </li>

      <li>
      Share two group selfies with geo-tagging:
      <ul>
      <li>On arrival at the center</li>
      <li>After the exam concludes</li>
      </ul>
      </li>

      <li>
      Please refer to the Deduction Terms and Scope of Work documents for details.
      </li>

      </ul>

      <br>

      <h4>3. Dress Code and Documentation</h4>

      <ul>

      <li>
      The operator must be properly dressed in formal attire, including formal shoes
      </li>

      <li>
      Carry the following:
      <ul>
      <li>Government-issued ID proof</li>
      <li>Authority letter</li>
      <li>ID card</li>
      </ul>
      </li>

      </ul>

      <p>
      <b>Note:</b>
      Strict action and penalties will be applicable in case of dress code violations.
      Operators must not wear slippers, lower wear, or any inappropriate attire.
      </p>

      <br>

      <h4>4. Attendance Malpractice</h4>

      <ul>

      <li>
      It has come to our notice that selfies are being shared even when the operator is not present at the center.
      </li>

      <li>
      Submission of edited or fake selfies is strictly prohibited and may lead to deduction.
      </li>

      <li>
      This is strictly against policy and may lead to penalties or even blacklisting of your vendor profile.
      </li>

      <li>
      Operators must not leave the center before 5:30 PM.
      Any violation will result in penalties.
      </li>

      </ul>

      <p style="color:red;">
      If any of the above issues are found, the full center payment will be deducted.
      </p>

      <br>

      <h4>5. CSR Feedback Form</h4>

      <ul>

      <li>
      The Feedback Report, signed by both the Observer and the Center SPOC,
      must be uploaded to the portal via the application and shared in the WhatsApp group no later than <b>${csrDate}</b>.
      </li>

      <li>
      The hard copy of the CSR must be dispatched no later than the next day EOD, with proper signature and stamp.
      </li>

      <li>
      The second advance will not be initiated unless 95% of the CSRs have been received from the vendor.
      </li>

      <li>
      The Supervisor must confirm entry &amp; biometric points during the mock
      </li>

      <li>
      A demo transaction must be performed
      </li>

      </ul>

      <br>

      <h4>6. Material Checklist</h4>

      <p>Ensure the following items are available:</p>

      <ul>

      <li>Tablet with buffer stock</li>

      <li>FPS device</li>

      <li>OTG cables (Type-C &amp; B-Type)</li>

      <li>One hologram sheet per operator</li>

      </ul>

      <p>
      <b>Note:</b>
      This is an Aadhaar-based exam.
      All devices must have internet connectivity via mobile hotspot.
      A shortfall in working devices will lead to payment deductions.
      </p>

      <br>

      <h4>7. Attachments</h4>

      <ol>

      <li>Biometric SOP</li>

      <li>Feedback Report / CSR (to be shared later)</li>

      <li>Deduction Terms</li>

      <li>Bank Details Format</li>

      <li>Center-wise Details</li>

      <li>Vendor Agreement</li>

      <li>seQRview video</li>

      <li>Interactive video</li>

      </ol>

      <br>

      <h4>8. Commercials</h4>

      <table border="1" cellpadding="8" cellspacing="0"
      style="border-collapse: collapse; width:350px; font-size:13px;">

      <tr>
      <th>Service</th>
      <th>Rate (INR)</th>
      </tr>

      <tr>
      <td>Single Shift / Double Shift</td>
      <td>${singleDouble}</td>
      </tr>

      <tr>
      <td>Training</td>
      <td>${trainingAmt}</td>
      </tr>

      <tr>
      <td>Mock (Supervisor Only)</td>
      <td>${mockAmt}</td>
      </tr>

      </table>

      <br>

      <p>
      <b>Note:</b>
      For any additional amount, prior written approval from the Vendor Manager is mandatory.
      No extra charges will be reimbursed without approval.
      </p>

      <br>

      <h4>9. Payment Terms</h4>

      <p>
      Following the confirmation mail, payment will be processed in 3 stages:
      </p>

      <ul>

      <li>
      40% Advance – 1 day before the exam
      </li>

      <li>
      30% Post material pickup and 95% CSR submission (4 to 10 days after the exam)
      </li>

      <li>
      30% After receipt of material at the Delhi Warehouse (60 to 75 days after the exam)
      </li>

      </ul>

      <br>

      <h4>10. GST &amp; Invoicing</h4>

      <ul>

      <li>
      If GST billing is applicable, mention this in your account details and in your response email.
      </li>

      <li>
      Share the hard copy of the bill only after full payment (excluding GST) is received.
      </li>

      <li>
      Complete the necessary processes on the GST portal after dispatch.
      </li>

      <li>
      GST payment is processed monthly between the 25th and 30th.
      </li>

      </ul>

      <h4>11. Escalation Matrix</h4>

      ${escalationHtml}

      <h4>12. Notes</h4>

      <p><b>Action Required:</b></p>

      <p>
      Please read all enclosed documents carefully and share your acceptance and required details at the earliest.
      For any clarification, feel free to reach out.
      </p>

      <p>
      In the absence of a response within two business days of receipt of this email,
      it shall be treated as an automatic acknowledgment (auto acceptance).
      </p>

      <p style="color:red; font-weight:bold;">

      Note:<br><br>

      Please note that the vendor shall be held fully responsible for any malpractice, misconduct, impersonation, or any other unauthorized activity carried out by any employee or operator deployed by them during the examination process. In such cases, strict legal action shall be initiated against both the vendor and the concerned operator/employee, and the vendor may also be blacklisted from future engagements.

      </p>

      <p>
      Regards,<br>
      Operations Team
      </p>

      </div>
  `;
}

function generateMailPreview(payload, token) {
  requireAuth_(token);
  return { subject: generateSubject(payload), htmlBody: buildMailHtmlBody(payload) };
}

// ---------------------------------------------------------------------------
// ATTACHMENTS EXPORT HELPERS
// ---------------------------------------------------------------------------

function exportSpreadsheetAsBlob_(exportSS, fileName) {
  SpreadsheetApp.flush();
  var url = "https://docs.google.com/spreadsheets/d/" + exportSS.getId() + "/export?format=xlsx";
  var wait = 5000;
  for (var i = 0; i < 5; i++) {
    try {
      var response = UrlFetchApp.fetch(url, {
        headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }
      });
      return response.getBlob().setName(fileName);
    } catch (e) {
      if (e.toString().indexOf("429") !== -1) {
        Utilities.sleep(wait);
        wait *= 2;
      } else {
        throw e;
      }
    }
  }
  throw new Error("Export failed after retries");
}

function writeRowsAsText_(sheet, rows) {
  if (!rows || !rows.length) return;
  var width = rows[0].length;
  var range = sheet.getRange(1, 1, rows.length, width);
  range.setNumberFormat('@');
  range.setValues(rows);
}

// Colors the header rows of an attachment sheet (dark blue background, white bold text) and freezes them
function styleHeaderRows_(sheet, headerRowCount, width) {
  if (!headerRowCount || !width) return;
  sheet.getRange(1, 1, headerRowCount, width)
    .setBackground("#1a56db")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setVerticalAlignment("middle");
  sheet.setFrozenRows(headerRowCount);
}

// ---------------------------------------------------------------------------
// LOGGING DISPATCH RECORD
// ---------------------------------------------------------------------------

/**
 * extra = { sender: email, centerRows: n, seqrRows: n, seqrAttached: "YES"/"NO" }
 */
function logDispatchRecord_(payload, subject, status, details, extra) {
  try {
    extra = extra || {};
    var sender = extra.sender || "Unknown";
    var sheet = getLogSheet_("Dispatch Audit");
    appendTextRow_(sheet, [
      nowStr_(),
      sender,
      payload.vendor_name || "",
      payload.vendor_mail || "",
      payload.zm_select || "",
      payload.shift || "",
      payload.cc || "",
      subject || "",
      status,
      details || "",
      payload.service || "",
      payload.exam_name || "",
      payload.exam_date || "",
      payload.project_code || "",
      payload.training || "",
      payload.enclosure || "",
      payload.mock || "",
      payload.reporting_time || "",
      String(payload.attachment_format || "xlsx").toUpperCase(),
      extra.centerRows == null ? "" : String(extra.centerRows),
      extra.seqrRows == null ? "" : String(extra.seqrRows),
      extra.seqrAttached || "",
      payload.operator_list_date || "",
      payload.final_operator_date || "",
      payload.csr_submit_date || ""
    ]);
  } catch (e) {}
}

// When the user selects "NO" in a popup (seQRview missing or duplicate - mail not sent), that is logged too
// reason: "seqr" or "duplicate"
function logDispatchSkip(payload, reason, token) {
  var sender = requireAuth_(token);
  payload = payload || {};
  var isDup = String(reason) === "duplicate";
  logDispatchRecord_(payload, generateSubject(payload),
    isDup ? "SKIPPED (duplicate)" : "SKIPPED (seQRview missing)",
    isDup
      ? "An identical mail had already been sent; the sender selected NO in the popup - mail not sent"
      : "seQRview data was missing; the sender selected NO in the popup - mail not sent",
    { sender: sender, seqrRows: isDup ? null : 0, seqrAttached: isDup ? "" : "NO" });
  return true;
}

// ---------------------------------------------------------------------------
// DUPLICATE GUARD
// ---------------------------------------------------------------------------

// Fingerprint: if any one of these fields differs, the mail is not treated as a duplicate
function dupFingerprint_(o) {
  var service = String(o.service || "Biometric");
  var frisking = service === "Frisking";
  var parts = [
    o.vendor_name, o.vendor_mail, o.cc, o.zm_select, service,
    o.project_code, o.exam_name, o.exam_date,
    o.shift, frisking ? "" : o.training, frisking ? o.enclosure : "", o.mock, o.reporting_time,
    o.operator_list_date, o.final_operator_date, o.csr_submit_date,
    o.center_rows, o.seqr_rows
  ];
  return parts.map(function (x) {
    return String(x == null ? "" : x).trim().replace(/\s+/g, " ").toLowerCase();
  }).join("|");
}

// list = [{vendor_name, vendor_mail, ..., center_rows, seqr_rows}, ...]
// Returns { "<vendor name lowercase>": { time, sender } } only for vendors whose identical mail was already SENT
function findDuplicateDispatches(list, token) {
  try {
    requireAuth_(token);
  } catch (e) {
    return {};
  }
  var out = {};
  try {
    var sheet = getLogSheet_("Dispatch Audit");
    var data = sheet.getDataRange().getDisplayValues();
    var seen = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[8]).indexOf("SENT") !== 0) continue;
      var fp = dupFingerprint_({
        vendor_name: row[2], vendor_mail: row[3], zm_select: row[4], shift: row[5], cc: row[6],
        service: row[10], exam_name: row[11], exam_date: row[12], project_code: row[13],
        training: row[14], enclosure: row[15], mock: row[16], reporting_time: row[17],
        center_rows: row[19], seqr_rows: row[20],
        operator_list_date: row[22], final_operator_date: row[23], csr_submit_date: row[24]
      });
      seen[fp] = { time: row[0], sender: row[1] };
    }
    (list || []).forEach(function (item) {
      var hit = seen[dupFingerprint_(item)];
      if (hit) out[String(item.vendor_name || "").trim().toLowerCase()] = hit;
    });
  } catch (e) {}
  return out;
}

// ---------------------------------------------------------------------------
// PROCESS DISPATCH
// ---------------------------------------------------------------------------

function processDispatch(payload, token) {
  var sender = "Unknown";
  try {
    sender = requireAuth_(token);
  } catch (authErr) {
    return { success: false, message: authErr.message };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { success: false, message: "The system is busy with another dispatch. Please retry." };
  }

  var exportSS = null;
  var subject = "";
  var centerRows = [];
  var seqrRows = [];
  try {
    if (!payload || !payload.vendor_name) {
      return { success: false, message: "Vendor name is missing." };
    }
    var toCheck = parseEmailList_(payload.vendor_mail);
    if (!toCheck.valid.length || toCheck.invalid.length) {
      return { success: false, message: "Invalid vendor email address: " + payload.vendor_mail };
    }
    var ccCheck = parseEmailList_(payload.cc);
    if (ccCheck.invalid.length) {
      return { success: false, message: "Invalid CC email address: " + ccCheck.invalid.join(", ") };
    }
    var centerHeaders = payload.center_headers || [];
    centerRows = payload.center_rows || [];
    if (!centerHeaders.length || !centerRows.length) {
      return { success: false, message: "No center records found for vendor: " + payload.vendor_name };
    }
    var centerTopRows = payload.center_top_rows || [];

    var seqrHeaders = payload.seqr_headers || [];
    seqrRows = payload.seqr_rows || [];
    var seqrTopRows = payload.seqr_top_rows || [];
    var seqrMissing = !seqrRows.length;

    // seQRview is mandatory: no mail is sent without confirmation
    if (seqrMissing && !payload.allow_without_seqr) {
      return { success: false, message: "seQRview data missing for " + payload.vendor_name + ". Confirmation required to send without it." };
    }

    var fileBase = safeFileName_(payload.vendor_name);
    var useCsv = String(payload.attachment_format || "xlsx").toLowerCase() === "csv";
    var attachments = [];

    // Center file = Row 1 of the uploaded file (rows above the header) + header row + vendor rows
    var centerTable = padRows_(centerTopRows.concat([centerHeaders], centerRows));
    var seqrTable = seqrMissing ? [] : padRows_(seqrTopRows.concat([seqrHeaders], seqrRows));

    if (useCsv) {
      attachments.push(Utilities.newBlob("\uFEFF" + toCsv_(centerTable),
        "text/csv", fileBase + "_Center_Details.csv"));
      if (!seqrMissing) {
        attachments.push(Utilities.newBlob("\uFEFF" + toCsv_(seqrTable),
          "text/csv", fileBase + "_seQRview_Data.csv"));
      }
    } else {
      exportSS = SpreadsheetApp.create("Vendor_" + fileBase + "_" + Date.now());
      var sheet1 = exportSS.getSheets()[0];
      sheet1.setName("Center Details");
      writeRowsAsText_(sheet1, centerTable);
      styleHeaderRows_(sheet1, centerTopRows.length + 1, centerTable[0].length);

      if (!seqrMissing) {
        var seqrSheet = exportSS.insertSheet("Seqrview Data");
        writeRowsAsText_(seqrSheet, seqrTable);
        styleHeaderRows_(seqrSheet, seqrTopRows.length + 1, seqrTable[0].length);
      }
      SpreadsheetApp.flush();
      Utilities.sleep(2000);
      attachments.push(exportSpreadsheetAsBlob_(exportSS, fileBase + ".xlsx"));
    }

    subject = generateSubject(payload);
    var mailOptions = {
      to: toCheck.valid.join(","),
      subject: subject,
      htmlBody: buildMailHtmlBody(payload),
      attachments: attachments,
      bcc: BCC_AUDIT_EMAIL
    };
    if (ccCheck.valid.length) mailOptions.cc = ccCheck.valid.join(",");

    MailApp.sendEmail(mailOptions);

    var okMsg = "Sent to " + payload.vendor_mail + " (" + centerRows.length + " center rows" +
      (seqrMissing ? ", WITHOUT seQRview data)" : ", " + seqrRows.length + " seQRview rows)");

    saveVendorMemory(payload);
    logDispatchRecord_(
      payload, subject,
      seqrMissing ? "SENT (WITHOUT seQRview)" : "SENT",
      seqrMissing ? okMsg + " | seQRview data was missing - the sender confirmed YES in the popup" : okMsg,
      { sender: sender, centerRows: centerRows.length, seqrRows: seqrRows.length, seqrAttached: seqrMissing ? "NO" : "YES" }
    );

    return { success: true, message: okMsg };

  } catch (err) {
    var errMsg = "Dispatch failed: " + err.toString();
    logDispatchRecord_(payload || {}, subject, "FAILED", errMsg,
      { sender: sender, centerRows: centerRows.length, seqrRows: seqrRows.length, seqrAttached: seqrRows.length ? "YES" : "NO" });
    return { success: false, message: errMsg };
  } finally {
    if (exportSS) {
      try { DriveApp.getFileById(exportSS.getId()).setTrashed(true); } catch (e) {}
    }
    lock.releaseLock();
  }
}
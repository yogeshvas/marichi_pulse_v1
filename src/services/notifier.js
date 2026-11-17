// Sends booking emails. This logs the message. Connect it to SES, SendGrid or SMTP when you go live.
export async function sendBookingEmail(to, subject, lines) {
  console.log(`[email] to=${to} subject="${subject}"\n  ${lines.join('\n  ')}`);
}

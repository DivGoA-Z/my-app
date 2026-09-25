// src/lib/whatsapp.ts
//
// Builds a wa.me deep link that opens a chat with the CUSTOMER's own
// number (CustomerProject.phone) — not the business's own number,
// which only ever appears on the PDF letterhead (lib/quotePdf.ts).
// Opening the link is what "sends" the quote in this app; there is no
// server-side WhatsApp integration, so this always requires the
// designer's own WhatsApp (Web or desktop) to actually be signed in.
//
// wa.me wants bare digits (country code + number, no '+', spaces or
// dashes) — CustomerProject.phone is stored human-formatted (see the
// example in types/customer.ts), so this strips everything else.

export function buildWhatsAppLink(phone: string, message: string): string {
  const digits = phone.replace(/[^0-9]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

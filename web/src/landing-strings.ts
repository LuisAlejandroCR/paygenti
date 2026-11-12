// web/src/landing-strings.ts: Spanish and English copy for the public landing page (web/landing.html).
// Keys match the data-i18n / data-i18n-label / data-i18n-content attributes there; landing.ts
// applies them. Values may carry <strong> and are trusted constants. Kept apart from the app's i18n.ts.
import type { Locale } from "./i18n";

const es = {
  "meta.title": "Paygenti — cobra con PayPal desde tu teléfono",
  "meta.desc":
    "Paygenti ayuda a puestos de comida y vendedores de calle a cobrar con PayPal: inicias el cobro, revisas el estado de la venta y confirmas el pago antes de entregar el pedido.",
  "meta.ogDesc":
    "Inicia el cobro, revisa el estado de la venta y confirma el pago antes de entregar el pedido.",
  skip: "Saltar al contenido",
  brand: "Paygenti, inicio",
  "lang.group": "Idioma",
  "nav.main": "Principal",
  "nav.more": "Más pantallas",
  "cta.demo": "Probar la demo",
  "cta.how": "Ver cómo funciona",
  "cta.app": "Abrir la pantalla de cobro",
  "hero.eyebrow": "Para puestos de comida y vendedores de calle",
  "hero.title": "Cobra con PayPal desde tu teléfono y sabe cuándo ya te pagaron.",
  "hero.lead":
    "Inicias el cobro, tu cliente paga desde un QR o un sticker, y tu pantalla dice <strong>PAGADO</strong> solo cuando PayPal confirmó el pago. Así entregas el pedido sin dudas.",
  "hero.note": "Demo en el sandbox de PayPal: ningún pago es real. PIN de prueba: 1234.",
  "hero.caption": "Rosa cuenta cómo cobra con Paygenti desde su teléfono.",
  "hero.captionFallback":
    "Grabación real de la pantalla de cobro: desbloquear, cobrar $95, esperar y PAGADO.",
  "video.unsupported": "Tu navegador no puede reproducir este video.",
  "video.failed": "El video no se pudo cargar.",
  "demo.title": "Mira la demo completa",
  "demo.lead":
    "Una venta de principio a fin: la vendedora cobra, el cliente paga y la pantalla dice PAGADO. Activa el sonido para escucharla.",
  "demo.caption": "Grabación real de la demo en el sandbox de PayPal: ningún pago es real.",
  "how.title": "Tres pasos en cada venta",
  "how.1.title": "Inicia el cobro",
  "how.1.body":
    "Teclea el monto o di el pedido en voz alta y toca <strong>Cobrar</strong>. Aparece un QR para que tu cliente lo escanee.",
  "how.2.title": "Revisa el estado de la venta",
  "how.2.body":
    "La pantalla muestra <strong>Esperando pago</strong> con el tiempo que queda. Puedes darle 5 minutos más o cancelar el cobro, y tu cliente ve el cambio al momento.",
  "how.3.title": "Confirma el pago",
  "how.3.body":
    "Cuando PayPal captura el pago, tu pantalla se pone verde, dice <strong>PAGADO</strong> y lo anuncia en voz alta. Una captura de pantalla falsa no suena.",
  "paid.title": "El momento del pago, en el mostrador",
  "paid.lead":
    "Mientras la vendedora atiende, el voice box espera el pago. Cuando PayPal lo confirma, se pone de color y dice <strong>PAGADO</strong> con el monto. Grabación real, sin retoques.",
  "paid.caption": 'Voice box real: pasa de "Sin internet, conectando" a "PAGADO, cuarenta pesos".',
  "product.title": "Así se ve hoy, sin retoques",
  "product.lead":
    "Grabaciones reales de la app web en un teléfono y del voice box en el mostrador.",
  "cap.charge":
    "<strong>Pantalla de la vendedora.</strong> Desbloquea con el PIN, cobra $95, muestra el QR mientras espera y cambia a PAGADO.",
  "cap.checkout":
    "<strong>Pantalla del cliente.</strong> Ve el puesto y el total antes de pagar. En la demo el pago es simulado.",
  "cap.voicebox":
    "<strong>Voice box en el mostrador.</strong> Muestra y dice cada estado: sin internet, pagado, repítelo, cancelado y falla de PayPal. Activa el sonido para escucharlo.",
  "cap.rosa2": 'Rosa: "Paygenti me ayuda a tener el proceso más claro y ordenado."',
  "trust.title": "Más claro y más ordenado",
  "trust.1.title": "Solo el pago confirmado cuenta",
  "trust.1.body": "PAGADO aparece cuando el servidor capturó el pago con PayPal, no antes.",
  "trust.2.title": "Tu teléfono, desbloqueado por ti",
  "trust.2.body":
    "Para cobrar, el teléfono se desbloquea una vez con el PIN del puesto, o con huella o Face ID donde el navegador lo permite.",
  "trust.3.title": "El dinero no se mueve solo",
  "trust.3.body":
    "Reembolsos y pagos a proveedores piden tu PIN otra vez. El asistente solo propone; una regla fija decide.",
  "trust.4.title": "Cada venta queda registrada",
  "trust.4.body": "Revisa las ventas del día y el corte de caja en la oficina del puesto.",
  honest:
    "Paygenti es un prototipo para el PayPal AI Hackathon. Esta demo corre en el sandbox de PayPal y no mueve dinero real.",
  "final.title": "Pruébalo en 60 segundos",
  "final.body":
    "Abre la demo: a la izquierda cobras como vendedora, a la derecha pagas como cliente. PIN de prueba: <strong>1234</strong>.",
  "footer.note": "Paygenti · Prototipo del PayPal AI Hackathon. No es un producto de PayPal.",
  "footer.backoffice": "Oficina del puesto",
  "sim.title": "Simula una venta",
  "sim.badge": "Simulación: no cobra ni llama a PayPal",
  "sim.step1": "Rosa dice el monto",
  "sim.step2": "La caja muestra el QR",
  "sim.step3": "El cliente paga con PayPal",
  "sim.step4": "PayPal captura: ¡Pagado!",
  "sim.s1.big": "Te escucho…",
  "sim.s1.text": "Rosa: «Son cuarenta pesos».",
  "sim.s2.big": "40 MXN · Escanea para pagar",
  "sim.s3.big": "Esperando pago…",
  "sim.s3.text":
    "El cliente paga con PayPal desde su teléfono. Todavía no dice PAGADO: falta que PayPal capture el pago.",
  "sim.s4.big": "¡Pagado! 40 MXN",
  "sim.s4.text":
    "Solo ahora, con el pago capturado por PayPal, la caja anuncia el pago en voz alta.",
  "sim.next": "Siguiente paso",
  "sim.again": "Otra vez",
  "sim.play": "Reproducir solo",
  "phone.title": "Ábrelo en tu teléfono",
  "phone.body":
    "Escanea el código con la cámara para probar la demo en tu propio teléfono, o abre el enlace.",
  "phone.qrAlt": "Código QR que abre paygenti.vercel.app/judge",
};

export type LandingKey = keyof typeof es;

const en: Record<LandingKey, string> = {
  "meta.title": "Paygenti — take PayPal payments from your phone",
  "meta.desc":
    "Paygenti helps food stalls and street vendors get paid with PayPal: start the charge, keep an eye on the sale and confirm the payment before you hand over the order.",
  "meta.ogDesc":
    "Start the charge, keep an eye on the sale and confirm the payment before you hand over the order.",
  skip: "Skip to content",
  brand: "Paygenti, home",
  "lang.group": "Language",
  "nav.main": "Main",
  "nav.more": "More screens",
  "cta.demo": "Try the demo",
  "cta.how": "See how it works",
  "cta.app": "Open the charge screen",
  "hero.eyebrow": "For food stalls and street vendors",
  "hero.title": "Take PayPal payments from your phone and know the moment you've been paid.",
  "hero.lead":
    "You start the charge, your customer pays from a QR code or a sticker, and your screen only says <strong>PAID</strong> once PayPal has confirmed the payment. No more guessing before you hand over the order.",
  "hero.note": "Demo on the PayPal sandbox: no real payments. Test PIN: 1234.",
  "hero.caption": "Rosa shows how she gets paid with Paygenti on her phone.",
  "hero.captionFallback":
    "Real recording of the charge screen: unlock, charge $95, wait, and PAID.",
  "video.unsupported": "Your browser can't play this video.",
  "video.failed": "This video couldn't load.",
  "demo.title": "Watch the full demo",
  "demo.lead":
    "One sale from start to finish: the vendor charges, the customer pays and the screen says PAID. Turn the sound on to hear it.",
  "demo.caption": "Real recording of the demo on the PayPal sandbox: no real payments.",
  "how.title": "Three steps, every sale",
  "how.1.title": "Start the charge",
  "how.1.body":
    "Type the amount or say the order out loud and tap <strong>Charge</strong>. A QR code appears for your customer to scan.",
  "how.2.title": "Keep an eye on the sale",
  "how.2.body":
    "The screen shows <strong>Waiting for payment</strong> and how much time is left. You can add 5 more minutes or cancel the charge, and your customer sees the change right away.",
  "how.3.title": "Confirm the payment",
  "how.3.body":
    "Once PayPal captures the payment, your screen turns green, says <strong>PAID</strong> and announces it out loud. A fake screenshot makes no sound.",
  "paid.title": "The moment you get paid, at the counter",
  "paid.lead":
    "While the vendor serves customers, the voice box waits for the payment. When PayPal confirms it, the screen lights up and says <strong>PAGADO</strong> (paid) with the amount. A real recording, unedited.",
  "paid.caption":
    'The real voice box: it goes from "Sin internet, conectando" (offline, connecting) to "PAGADO, cuarenta pesos" (paid, forty pesos).',
  "product.title": "What it looks like today, unedited",
  "product.lead": "Real recordings of the web app on a phone and of the voice box at the counter.",
  "cap.charge":
    "<strong>Vendor screen.</strong> Unlocks with the PIN, charges $95, shows the QR code while it waits and switches to PAID.",
  "cap.checkout":
    "<strong>Customer screen.</strong> Shows the stall and the total before paying. In the demo the payment is simulated.",
  "cap.voicebox":
    "<strong>Voice box at the counter.</strong> Shows and speaks every state: offline, paid, say it again, canceled and PayPal error. Turn the sound on to hear it.",
  "cap.rosa2": 'Rosa: "Paygenti helps me keep the whole process clearer and more organized."',
  "trust.title": "Clearer and more organized",
  "trust.1.title": "Only a confirmed payment counts",
  "trust.1.body": "PAID only shows up once the server has captured the payment with PayPal.",
  "trust.2.title": "Your phone, unlocked by you",
  "trust.2.body":
    "To take payments, you unlock the phone once with the stall's PIN, or with your fingerprint or Face ID where the browser supports it.",
  "trust.3.title": "Money never moves on its own",
  "trust.3.body":
    "Refunds and supplier payouts ask for your PIN again. The assistant only suggests; a fixed rule decides.",
  "trust.4.title": "Every sale is on record",
  "trust.4.body": "Check the day's sales and the end-of-day cash count in the stall's back office.",
  honest:
    "Paygenti is a prototype built for the PayPal AI Hackathon. This demo runs on the PayPal sandbox and doesn't move real money.",
  "final.title": "Try it in 60 seconds",
  "final.body":
    "Open the demo: on the left you charge as the vendor, on the right you pay as the customer. Test PIN: <strong>1234</strong>.",
  "footer.note": "Paygenti · A PayPal AI Hackathon prototype. Not a PayPal product.",
  "footer.backoffice": "Stall back office",
  "sim.title": "Simulate a sale",
  "sim.badge": "Simulation: no charge, no call to PayPal",
  "sim.step1": "Rosa says the amount",
  "sim.step2": "The box shows the QR code",
  "sim.step3": "The customer pays with PayPal",
  "sim.step4": "PayPal captures it: Paid!",
  "sim.s1.big": "Listening…",
  "sim.s1.text": "Rosa: “That's forty pesos.”",
  "sim.s2.big": "40 MXN · Scan to pay",
  "sim.s3.big": "Waiting for payment…",
  "sim.s3.text":
    "The customer pays with PayPal on their own phone. It doesn't say PAID yet: PayPal still has to capture the payment.",
  "sim.s4.big": "Paid! 40 MXN",
  "sim.s4.text":
    "Only now, with the payment captured by PayPal, does the box announce the payment out loud.",
  "sim.next": "Next step",
  "sim.again": "Start over",
  "sim.play": "Play it for me",
  "phone.title": "Open it on your phone",
  "phone.body":
    "Scan the code with your camera to try the demo on your own phone, or just open the link.",
  "phone.qrAlt": "QR code that opens paygenti.vercel.app/judge",
};

export const LANDING: Record<Locale, Record<LandingKey, string>> = { es, en };

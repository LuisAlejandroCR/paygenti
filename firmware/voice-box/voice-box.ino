// voice-box.ino: paygent voice box firmware (ESP32-S3 N16R8 + INMP441 + MAX98357A + ILI9341).
// Hold the button, speak ("cobrame 40 pesos de unos tacos"), release: the WAV goes to
// POST /api/terminals/:id/voice, the face shows the amount, and polling the sale shows PAGADO.

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP_I2S.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include "secrets.h"  // WIFI_SSID, WIFI_PASS, SERVER_URL, TERMINAL_ID (copy secrets.example.h)

// Pins (docs/voice-box-hardware.md §3).
constexpr int8_t MIC_SD = 4, MIC_SCK = 5, MIC_WS = 6;
constexpr uint8_t BUTTON = 7;
constexpr int8_t AMP_BCLK = 15, AMP_LRC = 16, AMP_DIN = 17;
constexpr int8_t TFT_SCK = 12, TFT_MOSI = 11, TFT_MISO = 13, TFT_CS = 10, TFT_DC = 9, TFT_RST = 21;

constexpr uint32_t RATE = 16000;
constexpr uint32_t MAX_SECONDS = 6;
constexpr size_t MAX_SAMPLES = RATE * MAX_SECONDS;
constexpr int MIC_SHIFT = 11;  // 24-bit sample in 32 bits -> int16 with ~8x gain (mic-check showed low levels).
constexpr uint32_t PAY_TIMEOUT_MS = 5 * 60 * 1000;
// The screen sits landscape in the box (320x240). Use 3 if the face shows upside down.
constexpr uint8_t TFT_ROTATION = 1;

// RGB565 palette.
constexpr uint16_t BG = 0xFFDF, INK = 0x2124, CHEEK = 0xFB56, GREEN = 0x2E8A, ORANGE = 0xFD20, WHITE = 0xFFFF;

Adafruit_ILI9341 tft(&SPI, TFT_DC, TFT_CS, TFT_RST);
I2SClass mic, amp;
uint8_t *wav = nullptr;  // 44-byte header + PCM16, in PSRAM.

enum Face { IDLE, LISTEN, THINK, OPEN, PAID, CONFUSED, OFFLINE };

// ---------- screen ----------

void eyes(Face f, uint16_t bg) {
  const int cx = tft.width() / 2, y = 80, lx = cx - 55, rx = cx + 55;
  for (int x : {lx, rx}) {
    switch (f) {
      case IDLE:
      case OFFLINE:  // closed: thick line
        tft.fillRoundRect(x - 20, y - 3, 40, 7, 3, INK);
        break;
      case PAID:  // happy ^ ^
        for (int t = 0; t < 6; t++) {
          tft.drawLine(x - 20, y + 8 + t / 2, x, y - 10 + t / 2, INK);
          tft.drawLine(x, y - 10 + t / 2, x + 20, y + 8 + t / 2, INK);
        }
        break;
      case CONFUSED:
        tft.fillCircle(x, y, 16, INK);
        tft.fillCircle(x + 5, y - 6, 5, WHITE);
        tft.fillRect(x - 22, y - 34, 44, 6, INK);  // brows
        break;
      default: {  // open eyes; THINK looks up, LISTEN is bigger
        int r = f == LISTEN ? 22 : 18, dy = f == THINK ? -8 : 0;
        tft.fillCircle(x, y, r, INK);
        tft.fillCircle(x + 6, y - 7 + dy, r / 3, WHITE);
      }
    }
  }
  if (f != OFFLINE) {
    tft.fillCircle(cx - 100, 112, 12, CHEEK);
    tft.fillCircle(cx + 100, 112, 12, CHEEK);
  }
  // Mouth: arc for smile, small "o" when listening.
  if (f == LISTEN) {
    tft.fillCircle(cx, 122, 10, INK);
    tft.fillCircle(cx, 122, 5, bg);
  } else if (f == CONFUSED) {
    tft.fillRect(cx - 20, 120, 40, 5, INK);
  } else {
    for (int t = 0; t < 4; t++) tft.drawCircleHelper(cx, 100 + t, 24, 0x4 | 0x8, INK);
  }
}

void face(Face f, const String &line1 = "", const String &line2 = "") {
  uint16_t bg = f == PAID ? GREEN : f == OFFLINE ? 0xC618 : BG;
  tft.fillScreen(bg);
  eyes(f, bg);
  tft.setTextColor(f == PAID ? WHITE : INK);
  tft.setTextWrap(false);
  int16_t x, y;
  uint16_t w, h;
  if (line1.length()) {
    tft.setTextSize(line1.length() > 10 ? 3 : 4);
    tft.getTextBounds(line1, 0, 0, &x, &y, &w, &h);
    tft.setCursor(max(0, (tft.width() - (int)w) / 2), 160);
    tft.print(line1);
  }
  if (line2.length()) {
    tft.setTextSize(2);
    tft.getTextBounds(line2, 0, 0, &x, &y, &w, &h);
    tft.setCursor(max(0, (tft.width() - (int)w) / 2), 208);
    tft.print(line2);
  }
}

// ---------- sound ----------

void tone(int hz, int ms, int vol = 6000) {
  static int16_t buf[RATE / 50];
  uint32_t n = 0;
  for (int c = 0; c < ms / 20; c++) {
    for (size_t i = 0; i < sizeof(buf) / 2; i++, n++) buf[i] = (int16_t)(vol * sin(2 * PI * hz * n / RATE));
    amp.write((uint8_t *)buf, sizeof(buf));
  }
}

void chimePaid() {
  tone(660, 120);
  tone(880, 120);
  tone(1320, 240);
}

// ---------- recording ----------

void putLE(uint8_t *p, uint32_t v, int n) {
  for (int i = 0; i < n; i++) p[i] = (v >> (8 * i)) & 0xFF;
}

void wavHeader(uint32_t samples) {
  uint32_t data = samples * 2;
  memcpy(wav, "RIFF", 4);
  putLE(wav + 4, 36 + data, 4);
  memcpy(wav + 8, "WAVEfmt ", 8);
  putLE(wav + 16, 16, 4);
  putLE(wav + 20, 1, 2);  // PCM
  putLE(wav + 22, 1, 2);  // mono
  putLE(wav + 24, RATE, 4);
  putLE(wav + 28, RATE * 2, 4);
  putLE(wav + 32, 2, 2);
  putLE(wav + 34, 16, 2);
  memcpy(wav + 36, "data", 4);
  putLE(wav + 40, data, 4);
}

/** Records while the button is held (max MAX_SECONDS); returns the sample count. */
uint32_t record() {
  int16_t *pcm = (int16_t *)(wav + 44);
  static int32_t raw[256];
  uint32_t n = 0;
  while (digitalRead(BUTTON) == LOW && n < MAX_SAMPLES) {
    size_t got = mic.readBytes((char *)raw, sizeof(raw)) / 4;
    for (size_t i = 0; i < got && n < MAX_SAMPLES; i++) {
      int32_t s = raw[i] >> MIC_SHIFT;
      pcm[n++] = (int16_t)constrain(s, -32768, 32767);
    }
  }
  return n;
}

// ---------- network ----------

bool wifiUp() {
  if (WiFi.status() == WL_CONNECTED) return true;
  face(OFFLINE, "Sin internet", "conectando...");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  if (WiFi.status() != WL_CONNECTED) return false;
  Serial.printf("wifi ok, ip %s\n", WiFi.localIP().toString().c_str());
  return true;
}

String money(long minor, const char *cur) {
  String s = String(minor / 100);
  if (minor % 100) s += "." + String(minor % 100 + 100).substring(1);
  return s + " " + cur;
}

/** Polls the sale until paid, cancelled/expired, a new press, or the timeout. */
void waitForPayment(const String &saleId, const String &amount) {
  uint32_t start = millis();
  HTTPClient http;
  while (millis() - start < PAY_TIMEOUT_MS) {
    for (int i = 0; i < 30; i++) {  // 1.5 s, but a press interrupts
      if (digitalRead(BUTTON) == LOW) return;
      delay(50);
    }
    http.begin(String(SERVER_URL) + "/api/sales/" + saleId);
    int code = http.GET();
    if (code == 200) {
      JsonDocument doc;
      if (!deserializeJson(doc, http.getString())) {
        String status = doc["sale"]["status"] | "";
        if (status == "paid") {
          http.end();
          face(PAID, "PAGADO", amount);
          chimePaid();
          delay(6000);
          return;
        }
        if (status == "cancelled" || status == "expired") {
          http.end();
          face(CONFUSED, "Cancelado");
          delay(3000);
          return;
        }
      }
    }
    http.end();
  }
}

void handlePress() {
  face(LISTEN, "Te escucho...");
  tone(880, 60, 3000);
  uint32_t n = record();
  Serial.printf("recorded %lu samples (%.1f s)\n", (unsigned long)n, n / (float)RATE);
  if (n < RATE / 3) {  // under ~0.3 s: a tap, not speech
    face(IDLE);
    return;
  }
  face(THINK, "...");
  if (!wifiUp()) {
    face(OFFLINE, "Sin internet");
    delay(2000);
    return;
  }
  wavHeader(n);
  HTTPClient http;
  http.setTimeout(30000);
  http.begin(String(SERVER_URL) + "/api/terminals/" + TERMINAL_ID + "/voice?lang=es");
  http.addHeader("Content-Type", "audio/wav");
  int code = http.POST(wav, 44 + n * 2);
  String body = code > 0 ? http.getString() : "";
  http.end();
  Serial.printf("POST voice -> %d %s\n", code, body.substring(0, 200).c_str());

  JsonDocument doc;
  if (code <= 0 || deserializeJson(doc, body)) {
    face(OFFLINE, "Sin servidor", String(code));
    delay(3000);
    face(IDLE);
    return;
  }
  String intent = doc["intent"] | "";
  if (intent != "charge") {
    String heard = doc["text"] | "";
    face(CONFUSED, "Repitelo", heard.substring(0, 18));
    tone(330, 200);
    delay(3000);
    face(IDLE);
    return;
  }
  long minor = doc["sale"]["total"]["minor"] | 0L;
  String amount = money(minor, doc["sale"]["total"]["currency"] | "");
  face(OPEN, amount, "Escanea para pagar");
  tone(660, 100);
  waitForPayment(doc["sale"]["id"] | "", amount);
  if (digitalRead(BUTTON) != LOW) face(IDLE);
}

// ---------- main ----------

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n== paygent voice box ==");
  pinMode(BUTTON, INPUT_PULLUP);

  SPI.begin(TFT_SCK, TFT_MISO, TFT_MOSI, TFT_CS);
  tft.begin(40000000);
  tft.setRotation(TFT_ROTATION);

  wav = (uint8_t *)ps_malloc(44 + MAX_SAMPLES * 2);
  if (!wav) Serial.println("PSRAM alloc FAIL");

  mic.setPins(MIC_SCK, MIC_WS, -1, MIC_SD);
  bool micOk = mic.begin(I2S_MODE_STD, RATE, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT);
  amp.setPins(AMP_BCLK, AMP_LRC, AMP_DIN);
  bool ampOk = amp.begin(I2S_MODE_STD, RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO);
  Serial.printf("mic %s, amp %s\n", micOk ? "OK" : "FAIL", ampOk ? "OK" : "FAIL");

  wifiUp();
  face(IDLE);
  Serial.printf("server %s, terminal %s; hold the button to talk\n", SERVER_URL, TERMINAL_ID);
}

void loop() {
  if (digitalRead(BUTTON) == LOW && wav) {
    delay(20);
    if (digitalRead(BUTTON) == LOW) handlePress();
  }
  delay(10);
}

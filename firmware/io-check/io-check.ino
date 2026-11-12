// io-check.ino: serial test for the voice box button, LED and amplifier.
// Button on GPIO 7 (to GND, INPUT_PULLUP), LED on GPIO 8, MAX98357A on BCLK=15, LRC=16, DIN=17.
// Each press prints "PRESS", lights the LED and plays a short 880 Hz beep.

#include <ESP_I2S.h>

constexpr uint8_t PIN_BUTTON = 7, PIN_LED = 8;
constexpr int8_t PIN_BCLK = 15, PIN_LRC = 16, PIN_DIN = 17;
constexpr uint32_t RATE = 16000;

I2SClass amp;
bool ampOk = false;

void beep(int ms) {
  if (!ampOk) return;
  static int16_t buf[RATE / 50];  // 20 ms chunks.
  const int chunks = ms / 20;
  uint32_t phase = 0;
  for (int c = 0; c < chunks; c++) {
    for (size_t i = 0; i < sizeof(buf) / sizeof(buf[0]); i++, phase++)
      buf[i] = (int16_t)(6000 * sin(2 * PI * 880 * phase / RATE));
    amp.write((uint8_t *)buf, sizeof(buf));
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n== io-check ==");
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  amp.setPins(PIN_BCLK, PIN_LRC, PIN_DIN);
  ampOk = amp.begin(I2S_MODE_STD, RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO);
  Serial.println(ampOk ? "amp I2S OK" : "amp I2S FAIL");
  Serial.printf("button idle reads %s (expect HIGH)\n", digitalRead(PIN_BUTTON) ? "HIGH" : "LOW");
  digitalWrite(PIN_LED, HIGH);
  beep(300);
  digitalWrite(PIN_LED, LOW);
  Serial.println("startup beep + LED flash done; press the button");
}

void loop() {
  static bool was = HIGH;
  bool now = digitalRead(PIN_BUTTON);
  if (now != was) {
    delay(20);  // Debounce.
    now = digitalRead(PIN_BUTTON);
    if (now != was) {
      was = now;
      if (now == LOW) {
        Serial.printf("PRESS at %lu ms\n", (unsigned long)millis());
        digitalWrite(PIN_LED, HIGH);
        beep(200);
      } else {
        Serial.println("RELEASE");
        digitalWrite(PIN_LED, LOW);
      }
    }
  }
  delay(5);
}

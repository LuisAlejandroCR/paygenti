// pin-scan.ino: finds which GPIO a push button is really wired to.
// Puts every free pin of the voice box (not mic, screen, amp, USB, PSRAM or strapping) in
// INPUT_PULLUP and prints any pin that changes, so pressing the button names its pin.

const uint8_t PINS[] = {1, 2, 7, 8, 14, 18, 38, 39, 40, 41, 42, 47};
constexpr size_t N = sizeof(PINS) / sizeof(PINS[0]);
bool last[N];

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n== pin-scan ==");
  for (size_t i = 0; i < N; i++) {
    pinMode(PINS[i], INPUT_PULLUP);
    delay(2);
    last[i] = digitalRead(PINS[i]);
    if (!last[i]) Serial.printf("GPIO %u reads LOW at rest (tied to GND?)\n", PINS[i]);
  }
  Serial.println("ready: press the button");
}

void loop() {
  for (size_t i = 0; i < N; i++) {
    bool now = digitalRead(PINS[i]);
    if (now != last[i]) {
      last[i] = now;
      Serial.printf("GPIO %u -> %s\n", PINS[i], now ? "HIGH (released)" : "LOW (pressed)");
    }
  }
  delay(10);
}

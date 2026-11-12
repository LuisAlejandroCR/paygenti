// mic-check.ino: serial test for the INMP441 microphone of the voice box.
// Reads 16 kHz I2S audio (SD=4, SCK=5, WS=6, L/R to GND) and prints a level bar
// ten times a second, so speaking near the mic should make the bar grow.

#include <ESP_I2S.h>

constexpr int8_t PIN_SD = 4;
constexpr int8_t PIN_SCK = 5;
constexpr int8_t PIN_WS = 6;
constexpr uint32_t RATE = 16000;
constexpr size_t SAMPLES = RATE / 10;  // 100 ms per line.

I2SClass i2s;
int32_t buf[SAMPLES];

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n== mic-check ==");
  i2s.setPins(PIN_SCK, PIN_WS, -1, PIN_SD);
  if (!i2s.begin(I2S_MODE_STD, RATE, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT)) {
    Serial.println("I2S FAIL: check pins");
    while (true) delay(1000);
  }
  Serial.println("I2S OK, speak near the mic");
}

void loop() {
  size_t got = i2s.readBytes((char *)buf, sizeof(buf)) / sizeof(int32_t);
  if (got == 0) {
    Serial.println("no data: check SCK/WS wiring");
    delay(500);
    return;
  }
  double sum = 0;
  int32_t peak = 0;
  for (size_t i = 0; i < got; i++) {
    int32_t s = buf[i] >> 14;  // 24-bit sample, left-justified in 32 bits, scaled to ~16 bits.
    sum += (double)s * s;
    if (abs(s) > peak) peak = abs(s);
  }
  int rms = (int)sqrt(sum / got);
  int bars = constrain(rms / 50, 0, 60);
  Serial.printf("rms %5d peak %6ld |", rms, (long)peak);
  for (int i = 0; i < bars; i++) Serial.print('#');
  Serial.println();
}

// board-check.ino: first smoke test for the voice box ESP32-S3 DevKitC N16R8.
// Prints chip, flash and PSRAM sizes over serial and cycles the on-board RGB LED,
// so we know the board, the USB port and the toolchain work before wiring anything.

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("== board-check ==");
  Serial.printf("chip: %s rev %d, %d cores @ %lu MHz\n", ESP.getChipModel(), ESP.getChipRevision(),
                ESP.getChipCores(), (unsigned long)ESP.getCpuFreqMHz());
  Serial.printf("flash: %lu MB\n", (unsigned long)(ESP.getFlashChipSize() / (1024 * 1024)));
  Serial.printf("psram: %lu KB (%s)\n", (unsigned long)(ESP.getPsramSize() / 1024),
                psramFound() ? "OK" : "NOT FOUND");
}

void loop() {
  static uint8_t step = 0;
  const uint8_t colors[3][3] = {{40, 0, 0}, {0, 40, 0}, {0, 0, 40}};
  rgbLedWrite(RGB_BUILTIN, colors[step][0], colors[step][1], colors[step][2]);
  Serial.printf("alive %lu ms, led %s\n", (unsigned long)millis(), step == 0 ? "red" : step == 1 ? "green" : "blue");
  step = (step + 1) % 3;
  delay(1000);
}

// rotation-check.ino: finds the right scan direction for the box screen, which behaves like an
// ILI9342 (native 320x240 landscape). Portrait 240x320 needs MV; four MX/MY flips, 6 s each, each
// in its own color with a full border and "ARRIBA" on top; the one that reads upright and unmirrored wins.

#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>

constexpr int8_t TFT_SCK = 12, TFT_MOSI = 11, TFT_MISO = 13, TFT_CS = 10, TFT_DC = 9, TFT_RST = 21;
Adafruit_ILI9341 tft(&SPI, TFT_DC, TFT_CS, TFT_RST);

// MADCTL bits: MY 0x80, MX 0x40, MV 0x20, BGR 0x08. MV turns the native 320x240 panel portrait.
const uint8_t MADCTL[4] = {0x28, 0x68, 0xA8, 0xE8};
const uint16_t COLORS[4] = {0xF800, 0x07E0, 0x001F, 0xFFE0};  // red, green, blue, yellow
const char *NAMES[4] = {"ROJO", "VERDE", "AZUL", "AMARILLO"};

void centered(const char *s, int size, int y) {
  int16_t x1, y1;
  uint16_t w, h;
  tft.setTextSize(size);
  tft.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  tft.setCursor((tft.width() - w) / 2, y);
  tft.print(s);
}

void setup() {
  Serial.begin(115200);
  SPI.begin(TFT_SCK, TFT_MISO, TFT_MOSI, TFT_CS);
  tft.begin(40000000);
  tft.setRotation(0);  // 240x320 logical size; MADCTL is overridden per test
  tft.setTextColor(0x0000);
}

void loop() {
  for (uint8_t i = 0; i < 4; i++) {
    uint8_t m = MADCTL[i];
    tft.sendCommand(ILI9341_MADCTL, &m, 1);
    tft.fillScreen(COLORS[i]);
    for (int b = 0; b < 4; b++) tft.drawRect(b, b, tft.width() - 2 * b, tft.height() - 2 * b, 0x0000);
    tft.fillTriangle(tft.width() / 2, 10, tft.width() / 2 - 15, 35, tft.width() / 2 + 15, 35, 0x0000);
    centered("ARRIBA", 2, 42);
    centered(NAMES[i], 5, tft.height() / 2 - 20);
    char buf[16];
    snprintf(buf, sizeof(buf), "0x%02X", m);
    centered(buf, 3, tft.height() / 2 + 30);
    Serial.printf("%s: MADCTL 0x%02X\n", NAMES[i], m);
    delay(6000);
  }
}

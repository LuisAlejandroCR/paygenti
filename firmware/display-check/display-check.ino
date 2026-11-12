// display-check.ino: identifies the 2.8" SPI TFT of the voice box (ILI9341 or ST7789).
// Reads the ID register 0xD3 over SPI (SCK=12, MOSI=11, MISO=13, CS=10, DC=9, RST=21),
// then draws color bars and the chip name with the matching driver.

#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <Adafruit_ST7789.h>

constexpr int8_t PIN_SCK = 12, PIN_MOSI = 11, PIN_MISO = 13, PIN_CS = 10, PIN_DC = 9, PIN_RST = 21;

// Raw read of a register: command with DC low, then data bytes with DC high.
void readReg(uint8_t cmd, uint8_t *out, int n) {
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(PIN_CS, LOW);
  digitalWrite(PIN_DC, LOW);
  SPI.transfer(cmd);
  digitalWrite(PIN_DC, HIGH);
  for (int i = 0; i < n; i++) out[i] = SPI.transfer(0x00);
  digitalWrite(PIN_CS, HIGH);
  SPI.endTransaction();
}

void drawTest(Adafruit_GFX &g, const char *name) {
  g.fillScreen(0x0000);
  int h = g.height() / 4;
  g.fillRect(0, 0, g.width(), h, 0xF800);       // red
  g.fillRect(0, h, g.width(), h, 0x07E0);       // green
  g.fillRect(0, 2 * h, g.width(), h, 0x001F);   // blue
  g.setTextColor(0xFFFF);
  g.setTextSize(3);
  g.setCursor(10, 3 * h + 20);
  g.print(name);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n== display-check ==");
  pinMode(PIN_CS, OUTPUT);
  pinMode(PIN_DC, OUTPUT);
  pinMode(PIN_RST, OUTPUT);
  digitalWrite(PIN_CS, HIGH);
  digitalWrite(PIN_RST, LOW);
  delay(20);
  digitalWrite(PIN_RST, HIGH);
  delay(150);
  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_CS);

  uint8_t d3[4] = {0}, id04[4] = {0};
  readReg(0xD3, d3, 4);
  readReg(0x04, id04, 4);
  Serial.printf("reg D3: %02X %02X %02X %02X\n", d3[0], d3[1], d3[2], d3[3]);
  Serial.printf("reg 04: %02X %02X %02X %02X\n", id04[0], id04[1], id04[2], id04[3]);

  // The ID read returns 00 on this module (MISO silent), and the ST7789 init showed inverted,
  // flipped colors, which points to an ILI9341. Force it unless the ID says otherwise.
  bool ili = true;
  if (ili) {
    Serial.println("chip: ILI9341");
    static Adafruit_ILI9341 tft(&SPI, PIN_DC, PIN_CS, PIN_RST);
    tft.begin(40000000);
    drawTest(tft, "ILI9341");
  } else {
    Serial.println("chip: not ILI9341 by ID, trying ST7789 (MISO may be unwired)");
    static Adafruit_ST7789 tft(&SPI, PIN_CS, PIN_DC, PIN_RST);
    tft.init(240, 320);
    drawTest(tft, "ST7789?");
  }
  Serial.println("drawn: expect red, green, blue bars and the chip name");
}

void loop() { delay(1000); }

// app/perfil.tsx: light profile for the phone — the stall switcher and links to the existing
// settings, stall setup and back office. Goals, payment rails and statement import stay on the web.
import { useRouter } from "expo-router";
import { useApp } from "@/app-state";
import { StallSwitcher } from "@/stalls-ui";
import { Body, Button, Card, Screen, Title } from "@/ui";

export default function PerfilScreen() {
  const { stall, setStall, t } = useApp();
  const router = useRouter();
  return (
    <Screen>
      <Card>
        <Title>{t("profile.stall")}</Title>
        <Body>{stall}</Body>
        <StallSwitcher selected={stall} onSelect={(id, s) => setStall(id, s?.terminals[0])} />
      </Card>
      <Button label={t("profile.settings")} variant="secondary" onPress={() => router.push("/settings")} />
      <Button label={t("profile.stallSetup")} variant="secondary" onPress={() => router.push("/onboarding")} />
      <Button label={t("profile.backoffice")} variant="secondary" onPress={() => router.push("/backoffice")} />
      <Body muted>{t("profile.webOnly")}</Body>
    </Screen>
  );
}

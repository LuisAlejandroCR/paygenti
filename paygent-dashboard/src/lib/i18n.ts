export type Lang = "es" | "pt" | "en";

const es = {
  hello: "Hola", tabs_resumen: "Resumen", tabs_ventas: "Ventas", tabs_rieles: "Rieles", tabs_movimientos: "Movimientos", tabs_metas: "Metas", tabs_perfil: "Perfil", profile: "Perfil", settings: "Ajustes", s_rails: "Métodos de cobro", s_goals: "Metas de ahorro", s_prefs: "Preferencias", rails_count: "{n} [método|métodos] de cobro",
  sales_of: "Ventas de", vs: "vs", day_of: "Ritmo del mes · {d}/{t} días", pct_of_last: "Llevas el {p}% de {m}",
  verified: "Verificado", declared: "Autodeclarado", pending: "Por confirmar", not_verified: "no verificado",
  how_paid: "Por dónde entró", see_all: "Detalle", last6: "Últimos 6 meses", pace: "Acumulado del mes", day: "Día", top_items: "Top productos",
  alert_spei: "{n} [pago|pagos] por confirmar", confirm_pin: "Confirmar con PIN", today_q: "Atajos",
  a_charge: "Cobrar", a_confirm: "Confirmar transferencia", a_refund: "Reembolso", a_payout: "Pagar a proveedor", a_import: "Importar estado de cuenta", a_export: "Exportar CSV",
  heatmap: "Mejores horas para vender", daily: "Ventas diarias", avg7: "Promedio 7 días", avg_ticket: "Ticket promedio", per_day: "Ventas/día", best_day: "Mejor día",
  conversion: "Conversión", avg_confirm: "Confirma en", on: "Activo", off: "Apagado",
  pix_mx: "Pix no disponible en México", spei_br: "SPEI no disponible en Brasil", oxxo_br: "OXXO solo opera en México",
  date: "Fecha", amount: "Monto", currency: "Moneda", rail: "Riel", status: "Estado", type: "Tipo", origin: "Origen",
  COMPLETED: "Pagado", pending_bank: "Por confirmar", refunded: "Reembolsado", denied: "Rechazado",
  venta: "Venta", reembolso: "Reembolso", payout: "Payout", local_filter: "filtro local",
  search: "Buscar…", filters: "Filtros", empty: "Sin movimientos aquí", retry: "Reintentar", error: "No pudimos cargar",
  create_goal: "Crear meta", goal_due: "Para {d}", import_title: "Importar estado de cuenta", drop: "Arrastra un CSV/OFX o toca para elegir",
  months_found: "Meses", income: "Ingresos", own_transfers: "{n} [traspaso|traspasos] entre tus cuentas, no [cuenta|cuentan] como ingreso",
  confirm: "Confirmar", cancel: "Cancelar", next: "Siguiente", back: "Atrás", save: "Guardar", close: "Cerrar",
  pin_title: "PIN del puesto", pin_hint: "PIN demo: 1234", pin_wrong: "PIN incorrecto",
  done: "Listo", undo: "Deshacer", dismissed: "Aviso ocultado", proposed_ai: "Propuesto por IA", proposed: "Propuesta — requiere PIN",
  waiting: "Esperando pago…", paid: "¡Pagado!", failed: "Falló", choose_rail: "Elige cómo cobrar", share_link: "Muestra el QR o comparte el link",
  view_table: "Ver como tabla", view_chart: "Ver gráfica", export: "Exportar", reset_zoom: "Restablecer zoom",
  notifications: "Avisos", notif_spei: "Tienes pagos SPEI por confirmar", notif_goal: "Vas al 68% de tu meta", notif_payout: "Pago a proveedor enviado",
  privacy: "Ocultar montos", dark: "Modo oscuro", large: "Texto grande", lang: "Idioma",
  timeline: "Historial", fee: "Comisión", refund_with_pin: "Reembolsar con PIN", selected: "{n} [seleccionado|seleccionados]", confirm_pending: "Confirmar pendientes",
  compare: "Comparar", rail_setup: "Configuración", hours: "Mejores horas", rails_used: "Rieles usados",
  target: "Meta", deadline: "Fecha límite", move_money: "Mover dinero", name: "Nombre", step: "Paso {n} de 3",
  range: "Rango", columns: "Columnas", download: "Descargar", from: "Desde", to: "Hasta", sales_in: "Ventas en {x}",
  preview: "Vista previa", supplier: "Proveedor", reason: "Motivo", result_ok: "Hecho", filter_chip: "Riel: {r}",
  daybyday: "Día a día vs mes anterior", count: "{n} [venta|ventas]", sandbox: "Sandbox", pull: "Desliza para actualizar",
};
type Dict = typeof es;

const pt: Dict = {
  ...es,
  hello: "Olá", tabs_resumen: "Resumo", tabs_ventas: "Vendas", tabs_rieles: "Meios", tabs_movimientos: "Movimentos", tabs_metas: "Metas", tabs_perfil: "Perfil", profile: "Perfil", settings: "Ajustes", s_rails: "Meios de cobrança", s_goals: "Metas de poupança", s_prefs: "Preferências", rails_count: "{n} [meio|meios] de cobrança",
  sales_of: "Vendas de", day_of: "Ritmo do mês · {d}/{t} dias", pct_of_last: "Já tem {p}% de {m}",
  verified: "Verificado", declared: "Autodeclarado", pending: "A confirmar", not_verified: "não verificado",
  how_paid: "Por onde entrou", see_all: "Detalhe", last6: "Últimos 6 meses", pace: "Acumulado do mês", day: "Dia", top_items: "Mais vendidos",
  alert_spei: "{n} [pagamento|pagamentos] a confirmar", confirm_pin: "Confirmar com PIN", today_q: "Atalhos",
  a_charge: "Cobrar", a_confirm: "Confirmar transferência", a_refund: "Reembolso", a_payout: "Pagar fornecedor", a_import: "Importar extrato", a_export: "Exportar CSV",
  heatmap: "Melhores horários", daily: "Vendas diárias", avg7: "Média 7 dias", avg_ticket: "Ticket médio", per_day: "Vendas/dia", best_day: "Melhor dia",
  conversion: "Conversão", avg_confirm: "Confirma em", on: "Ativo", off: "Desligado",
  date: "Data", amount: "Valor", currency: "Moeda", rail: "Meio", status: "Status", type: "Tipo", origin: "Origem",
  COMPLETED: "Pago", pending_bank: "A confirmar", refunded: "Reembolsado", denied: "Recusado", venta: "Venda",
  search: "Buscar…", filters: "Filtros", empty: "Sem movimentos aqui", retry: "Tentar de novo", error: "Não conseguimos carregar",
  create_goal: "Criar meta", goal_due: "Até {d}", import_title: "Importar extrato", drop: "Arraste um CSV/OFX ou toque para escolher",
  months_found: "Meses", income: "Receitas", own_transfers: "{n} [transferência|transferências] entre suas contas, não [conta|contam] como receita",
  confirm: "Confirmar", cancel: "Cancelar", next: "Próximo", back: "Voltar", save: "Salvar", close: "Fechar",
  pin_title: "PIN da barraca", pin_wrong: "PIN incorreto", done: "Pronto", undo: "Desfazer", dismissed: "Aviso ocultado",
  proposed_ai: "Proposto pela IA", proposed: "Proposta — requer PIN", waiting: "Aguardando pagamento…", paid: "Pago!", failed: "Falhou",
  choose_rail: "Escolha como cobrar", share_link: "Mostre o QR ou compartilhe o link", view_table: "Ver como tabela", view_chart: "Ver gráfico",
  export: "Exportar", reset_zoom: "Redefinir zoom", notifications: "Avisos", notif_spei: "Você tem pagamentos a confirmar",
  notif_goal: "Você está em 68% da meta", notif_payout: "Pagamento ao fornecedor enviado", privacy: "Ocultar valores",
  dark: "Modo escuro", large: "Texto grande", lang: "Idioma", timeline: "Histórico", fee: "Taxa", refund_with_pin: "Reembolsar com PIN",
  selected: "{n} [selecionado|selecionados]", confirm_pending: "Confirmar pendentes", compare: "Comparar", rail_setup: "Configuração",
  hours: "Melhores horários", rails_used: "Meios usados", target: "Meta", deadline: "Prazo", move_money: "Mover dinheiro",
  name: "Nome", step: "Passo {n} de 3", range: "Período", columns: "Colunas", download: "Baixar", from: "De", to: "Até",
  sales_in: "Vendas em {x}", preview: "Prévia", supplier: "Fornecedor", reason: "Motivo", result_ok: "Feito", filter_chip: "Meio: {r}",
  daybyday: "Dia a dia vs mês anterior", count: "{n} [venda|vendas]", pull: "Puxe para atualizar",
};

const en: Dict = {
  ...es,
  hello: "Hi", tabs_resumen: "Overview", tabs_ventas: "Sales", tabs_rieles: "Rails", tabs_movimientos: "Activity", tabs_metas: "Goals", tabs_perfil: "Profile", profile: "Profile", settings: "Settings", s_rails: "Payment methods", s_goals: "Savings goals", s_prefs: "Preferences", rails_count: "{n} payment [method|methods]",
  sales_of: "Sales in", day_of: "Month pace · {d}/{t} days", pct_of_last: "At {p}% of {m}",
  verified: "Verified", declared: "Self-declared", pending: "To confirm", not_verified: "not verified",
  how_paid: "Where it came in", see_all: "Details", last6: "Last 6 months", pace: "Month to date", day: "Day", top_items: "Top sellers",
  alert_spei: "{n} [payment|payments] to confirm", confirm_pin: "Confirm with PIN", today_q: "Shortcuts",
  a_charge: "Charge", a_confirm: "Confirm transfer", a_refund: "Refund", a_payout: "Pay supplier", a_import: "Import statement", a_export: "Export CSV",
  heatmap: "Best hours to sell", daily: "Daily sales", avg7: "7-day average", avg_ticket: "Avg ticket", per_day: "Sales/day", best_day: "Best day",
  conversion: "Conversion", avg_confirm: "Confirms in", on: "On", off: "Off",
  pix_mx: "Pix not available in Mexico", spei_br: "SPEI not available in Brazil", oxxo_br: "OXXO only operates in Mexico",
  date: "Date", amount: "Amount", currency: "Currency", rail: "Rail", status: "Status", type: "Type", origin: "Origin",
  COMPLETED: "Paid", pending_bank: "To confirm", refunded: "Refunded", denied: "Denied", venta: "Sale", reembolso: "Refund",
  local_filter: "local filter", search: "Search…", filters: "Filters", empty: "No activity here", retry: "Retry", error: "Couldn't load",
  create_goal: "Create goal", goal_due: "By {d}", import_title: "Import bank statement", drop: "Drop a CSV/OFX or tap to choose",
  months_found: "Months", income: "Income", own_transfers: "{n} [transfer|transfers] between your accounts, not counted as income",
  confirm: "Confirm", cancel: "Cancel", next: "Next", back: "Back", save: "Save", close: "Close",
  pin_title: "Stall PIN", pin_hint: "Demo PIN: 1234", pin_wrong: "Wrong PIN", done: "Done", undo: "Undo", dismissed: "Alert dismissed",
  proposed_ai: "Proposed by AI", proposed: "Proposal — needs PIN", waiting: "Waiting for payment…", paid: "Paid!", failed: "Failed",
  choose_rail: "Choose how to charge", share_link: "Show the QR or share the link", view_table: "View as table", view_chart: "View chart",
  export: "Export", reset_zoom: "Reset zoom", notifications: "Notifications", notif_spei: "You have transfers to confirm",
  notif_goal: "You're at 68% of your goal", notif_payout: "Supplier payment sent", privacy: "Hide amounts", dark: "Dark mode",
  large: "Large text", lang: "Language", timeline: "Timeline", fee: "Fee", refund_with_pin: "Refund with PIN", selected: "{n} selected",
  confirm_pending: "Confirm pending", compare: "Compare", rail_setup: "Setup", hours: "Best hours", rails_used: "Rails used",
  target: "Target", deadline: "Deadline", move_money: "Move money", name: "Name", step: "Step {n} of 3", range: "Range",
  columns: "Columns", download: "Download", from: "From", to: "To", sales_in: "Sales on {x}", preview: "Preview", supplier: "Supplier",
  reason: "Reason", result_ok: "Done", filter_chip: "Rail: {r}", daybyday: "Day by day vs last month", count: "{n} [sale|sales]", pull: "Pull to refresh",
};

export const DICTS: Record<Lang, Dict> = { es, pt, en };
export const LOCALES: Record<Lang, string> = { es: "es-MX", pt: "pt-BR", en: "en-US" };
export type TKey = keyof Dict;

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>) {
  let s = DICTS[lang][key] ?? key;
  if (vars) for (const k in vars) s = s.replace(`{${k}}`, String(vars[k]));
  // "[one|many]" picks the singular when n is 1
  if (vars && "n" in vars) s = s.replace(/\[([^|\]]*)\|([^\]]*)\]/g, (_, one, many) => (Number(vars["n"]) === 1 ? one : many));
  return s;
}

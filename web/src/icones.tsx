// Ícones de traço, desenhados em uma grade de 24 px. A cor vem do texto em volta (currentColor).
const desenhos = {
  inicio: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5',
  pessoas: 'M16 19.5v-1.2a3.8 3.8 0 0 0-3.8-3.8H7.8A3.8 3.8 0 0 0 4 18.3v1.2M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 19.5v-1.2a3.8 3.8 0 0 0-2.8-3.6M15 4.2a3.5 3.5 0 0 1 0 6.6',
  produtos: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3ZM4.3 7.7 12 12l7.7-4.3M12 12v9',
  entradas: 'M12 3v11m0 0-4-4m4 4 4-4M4 16v3.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V16',
  pedidos: 'M6 3.5h12a1 1 0 0 1 1 1V21l-3-1.8-2 1.8-2-1.8-2 1.8-2-1.8L5 21V4.5a1 1 0 0 1 1-1ZM9 8.5h6M9 12.5h6',
  devolucoes: 'M9 14 4.5 9.5 9 5M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3',
  entregas: 'M2.5 6.5h11v10h-11zM13.5 10h4l3 3.2v3.3h-7M7 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM17 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  promocoes: 'M20.5 12.6 12.6 20.5a1.7 1.7 0 0 1-2.4 0L3.5 13.8V4.5a1 1 0 0 1 1-1h9.3l6.7 6.7a1.7 1.7 0 0 1 0 2.4ZM8 8h.01',
  financeiro: 'M3.5 6.5h17v11h-17zM3.5 10h17M7 14.5h3',
  dashboards: 'M4 20V10M10 20V4M16 20v-7M21 20H3',
  relatorios: 'M7 3.5h7l4 4v13H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1ZM14 3.5v4h4M9.5 12.5h5M9.5 16h5',
  usuarios: 'M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5 20v-1a4.5 4.5 0 0 1 4.5-4.5h5A4.5 4.5 0 0 1 19 19v1M12 14.5v2.5',
  empresas: 'M4 20.5V5.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M14 9.5h5a1 1 0 0 1 1 1v10M2.5 20.5h19M7.5 8h3M7.5 11.5h3M7.5 15h3M17 13.5h.01M17 17h.01',
  menu: 'M4 7h16M4 12h16M4 17h16',
  fechar: 'M6 6l12 12M18 6 6 18',
  chave: 'M14.5 9.5a4 4 0 1 0-4.3 4L4 19.5V21h3v-2h2v-2h2l1.7-1.7a4 4 0 0 0 1.8-5.8ZM16 8h.01',
  sair: 'M10 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h4M14.5 16l4-4-4-4M18.5 12h-9',
  vazio: 'M4 13.5 6.5 5h11L20 13.5M4 13.5V19h16v-5.5M4 13.5h4.5l1 2.5h5l1-2.5H20',
  busca: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  sino: 'M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9ZM10 19a2 2 0 0 0 4 0',
  recolher: 'M4.5 4.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1ZM9 4.5v15M15.5 9.5 13 12l2.5 2.5',
  expandir: 'M4.5 4.5h15a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1ZM9 4.5v15M13.5 9.5 16 12l-2.5 2.5',
  vendas: 'M4 17 9.5 11.5l3.5 3.5L20 8M15 8h5v5',
  receber: 'M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5M5 20h14',
  pagar: 'M12 20V8m0 0-4.5 4.5M12 8l4.5 4.5M5 4h14',
  saldo: 'M4 7.5h16v10H4zM4 10.5h16M15.5 14h1.5',
  calendario: 'M5.5 5.5h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1ZM4.5 10h15M8.5 3.5v4M15.5 3.5v4',
  anterior: 'M14.5 6 8.5 12l6 6',
  proximo: 'm9.5 6 6 6-6 6',
  alertaIcone: 'M12 4 2.8 19.5h18.4L12 4ZM12 10v4.5M12 17.2h.01',
} as const

export type NomeIcone = keyof typeof desenhos

export function Icone({ nome }: { nome: NomeIcone }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={desenhos[nome]} />
    </svg>
  )
}

import { CampoData } from './calendario'
import { brl, hojeIso } from './format'
import { Icone } from './icones'
import { Dinheiro } from './ui'

// Parcelas com data e valor escolhidos à mão (pedido, faturamento, entrada e despesa a prazo).
export type Parcela = { vencimento: string; valor: number }

// Mesmo dia nos meses seguintes; no dia 31, um mês mais curto fica no último dia dele (como a API).
function somarMeses(dia: string, meses: number) {
  const [a, m, d] = dia.split('-').map(Number)
  const ultimo = new Date(a, m - 1 + meses + 1, 0).getDate()
  const data = new Date(a, m - 1 + meses, Math.min(d, ultimo))
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

// Divide o total em parcelas mensais iguais a partir da primeira data. Os centavos que sobram vão na
// primeira parcela (como o faturamento do pedido) ou na última (como a despesa).
export function dividirParcelas(total: number, quantidade: number, primeira = hojeIso(), restoNa: 'primeira' | 'ultima' = 'primeira'): Parcela[] {
  const n = Math.max(1, quantidade)
  const base = Math.floor(total / n)
  const resto = total - base * n
  const comResto = restoNa === 'primeira' ? 0 : n - 1
  return Array.from({ length: n }, (_, i) => ({ vencimento: somarMeses(primeira, i), valor: base + (i === comResto ? resto : 0) }))
}

export const somaParcelas = (parcelas: Parcela[]) => parcelas.reduce((s, p) => s + p.valor, 0)

export function TabelaParcelas(props: {
  parcelas: Parcela[]
  onChange: (parcelas: Parcela[]) => void
  // Total que as parcelas precisam somar; o aviso aparece quando não fecham.
  total: number
  rotuloTotal: string
  maximo?: number
  restoNa?: 'primeira' | 'ultima'
}) {
  const { parcelas, onChange, total } = props
  const maximo = props.maximo ?? 24
  const soma = somaParcelas(parcelas)
  const trocar = (i: number, parte: Partial<Parcela>) => onChange(parcelas.map((p, n) => (n === i ? { ...p, ...parte } : p)))
  // Incluir ou tirar uma parcela redivide o total em valores iguais, mantendo as datas escolhidas.
  const redividir = (novas: Parcela[]) => {
    const valores = dividirParcelas(total, novas.length, undefined, props.restoNa).map((p) => p.valor)
    onChange(novas.map((p, i) => ({ ...p, valor: valores[i] })))
  }
  // A parcela nova fica um mês depois da última.
  const incluir = () => {
    const ultima = parcelas.at(-1)?.vencimento ?? hojeIso()
    redividir([...parcelas, { vencimento: parcelas.length ? somarMeses(ultima, 1) : ultima, valor: 0 }])
  }

  return (
    <div className="parcelas">
      <table>
        <thead>
          <tr>
            <th>Parcela</th>
            <th>Vencimento</th>
            <th className="num">Valor (R$)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {parcelas.map((p, i) => (
            <tr key={i}>
              <td className="texto-suave">
                {i + 1}/{parcelas.length}
              </td>
              <td>
                <CampoData type="date" required aria-label={`Vencimento da parcela ${i + 1}`} value={p.vencimento} onChange={(e) => trocar(i, { vencimento: e.target.value })} />
              </td>
              <td className="num">
                <Dinheiro className="curto" required aria-label={`Valor da parcela ${i + 1}`} valor={p.valor} onChange={(valor) => trocar(i, { valor })} />
              </td>
              <td className="num">
                <button type="button" className="botao-icone" aria-label={`Tirar a parcela ${i + 1}`} disabled={parcelas.length === 1} onClick={() => redividir(parcelas.filter((_, n) => n !== i))}>
                  <Icone nome="fechar" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="parcelas-pe">
        <button type="button" className="botao botao-texto" onClick={incluir} disabled={parcelas.length >= maximo}>
          + Incluir parcela
        </button>
        <button
          type="button"
          className="botao botao-texto"
          onClick={() => onChange(dividirParcelas(total, parcelas.length, parcelas[0]?.vencimento, props.restoNa))}
          title="Valores iguais e um mês entre as datas, a partir da primeira"
        >
          Dividir igualmente
        </button>
        <span className={soma === total ? 'texto-suave' : 'texto-ruim'}>
          {soma === total ? `Somam ${brl(soma)}.` : `As parcelas somam ${brl(soma)}; ${props.rotuloTotal} é ${brl(total)}.`}
        </span>
      </div>
    </div>
  )
}

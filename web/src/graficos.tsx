import { brl } from './format'
import type { ItemRanking } from './types'

const moedaCompacta = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const compacto = (centavos: number) => moedaCompacta.format(centavos / 100)

// Topo do eixo: o menor valor "redondo" (1, 2 ou 5 vezes uma potência de 10) que cobre o máximo.
function tetoRedondo(centavos: number) {
  const reais = centavos / 100
  if (reais <= 0) return 100
  const base = 10 ** Math.floor(Math.log10(reais))
  const fator = [1, 2, 5, 10].find((m) => m * base >= reais) ?? 10
  return fator * base * 100
}

export type Serie = { nome: string; cor: string }
export type Ponto = {
  rotulo: string
  titulo: string
  valores: number[]
  nota?: string
  // Cor por barra, para destacar um ponto; sem isso vale a cor da série.
  cores?: string[]
}

// Gráfico de colunas com uma ou mais séries lado a lado, num único eixo.
export function Colunas(props: {
  series: Serie[]
  pontos: Ponto[]
  mostrarRotulo?: (indice: number) => boolean
  // Valor escrito sobre a coluna; use só com poucos pontos e uma série.
  valorNoTopo?: boolean
}) {
  const { series, pontos } = props
  const maximo = tetoRedondo(Math.max(0, ...pontos.flatMap((p) => p.valores)))
  const marcas = [maximo, maximo / 2, 0]

  return (
    <figure className="grafico">
      {series.length > 1 && (
        <figcaption className="legenda">
          {series.map((s) => (
            <span key={s.nome}>
              <i style={{ background: s.cor }} />
              {s.nome}
            </span>
          ))}
        </figcaption>
      )}
      <div className="grafico-corpo">
        <div className="grafico-eixo" aria-hidden="true">
          {marcas.map((m) => (
            <span key={m}>{compacto(m)}</span>
          ))}
        </div>
        <div className="grafico-plano">
          {marcas.map((m, i) => (
            <div key={m} className="grafico-grade" style={{ top: `${i * 50}%` }} />
          ))}
          <div className="grafico-colunas">
            {pontos.map((p, i) => (
              <div
                key={p.rotulo}
                className="grafico-slot"
                tabIndex={0}
                aria-label={`${p.titulo}: ${p.valores.map((v, s) => `${series[s].nome} ${brl(v)}`).join(', ')}`}
              >
                <div className="grafico-barras">
                  {p.valores.map((v, s) => (
                    <span
                      key={series[s].nome}
                      className="grafico-barra"
                      style={{
                        height: `${(v / maximo) * 100}%`,
                        minHeight: v > 0 ? 2 : 0,
                        background: p.cores?.[s] ?? series[s].cor,
                      }}
                    />
                  ))}
                </div>
                {props.valorNoTopo && p.valores[0] > 0 && (
                  <span className="grafico-valor" style={{ bottom: `${(p.valores[0] / maximo) * 100}%` }}>
                    {compacto(p.valores[0])}
                  </span>
                )}
                <div className={`dica ${i < pontos.length / 2 ? 'dica-esquerda' : 'dica-direita'}`} role="tooltip">
                  <strong>{p.titulo}</strong>
                  {p.valores.map((v, s) => (
                    <span key={series[s].nome}>
                      <i style={{ background: p.cores?.[s] ?? series[s].cor }} />
                      {series.length > 1 && `${series[s].nome}: `}
                      {brl(v)}
                    </span>
                  ))}
                  {p.nota && <span className="texto-suave">{p.nota}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <span />
        <div className="grafico-rotulos" aria-hidden="true">
          {pontos.map((p, i) => (
            <span key={p.rotulo}>{!props.mostrarRotulo || props.mostrarRotulo(i) ? p.rotulo : ''}</span>
          ))}
        </div>
      </div>
    </figure>
  )
}

// Lista ordenada com barra proporcional ao maior valor.
export function Ranking(props: { itens: ItemRanking[]; textoVazio: string; cor: string }) {
  if (props.itens.length === 0) return <p className="aviso">{props.textoVazio}</p>
  const maximo = Math.max(...props.itens.map((i) => i.total))
  return (
    <ol className="ranking">
      {props.itens.map((item, i) => (
        <li key={item.nome}>
          <span className="ranking-nome" title={item.nome}>
            <span className="texto-suave">{i + 1}.</span> {item.nome}
          </span>
          <span className="ranking-valor">{brl(item.total)}</span>
          <span className="ranking-barra" style={{ width: `${maximo > 0 ? (item.total / maximo) * 100 : 0}%`, background: props.cor }} />
        </li>
      ))}
    </ol>
  )
}

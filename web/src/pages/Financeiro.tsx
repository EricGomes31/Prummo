import { useState, type FormEvent, type ReactNode } from 'react'
import { api, useAcao, useDados } from '../api'
import { useSessao } from '../auth'
import { BANCOS } from '../bancos'
import { agoraLocal, brl, dataBr, dataHoraBr, estaVencida, formasPagamento, hojeIso, mascaraDocumento, naturezasPedido, origensMovimento, telefoneBr, tiposContaFinanceira } from '../format'
import { exportarCsv, imprimir, Resumo, Tabela, type Coluna } from '../relatorio'
import type { Conta, ContaFinanceira, Extrato, MovimentoFinanceiro, Pessoa, RelatorioCobranca, ContaComOrigem } from '../types'
import { Cabecalho, Campo, Dinheiro, Erro, EstadoLista, Modal, Selo, usePaginacao } from '../ui'
import { Conciliacao } from './Conciliacao'
import { Despesas } from './Despesas'
import { CampoData } from '../calendario'
import { Escolha, opcoesDePessoas } from '../escolha'
import { Documentos } from '../Documentos'

const abas = {
  'contas-receber': { rotulo: 'A receber', baixar: 'Receber', baixa: 'Recebimento', pessoa: 'Cliente', classificacao: 'cliente' },
  'contas-pagar': { rotulo: 'A pagar', baixar: 'Pagar', baixa: 'Pagamento', pessoa: 'Fornecedor', classificacao: 'fornecedor' },
} as const
type AbaContas = keyof typeof abas
type Aba = AbaContas | 'despesas' | 'caixa' | 'conciliacao'
const rotulosDasAbas: Record<Aba, string> = { 'contas-receber': 'A receber', 'contas-pagar': 'A pagar', despesas: 'Despesas', caixa: 'Caixa e bancos', conciliacao: 'Conciliação' }

const saldoDe = (c: Conta) => c.valor - c.valorPago
// O campo de data e hora do navegador vem sem fuso; a API recebe o instante exato.
const instante = (local: string) => new Date(local).toISOString()

export function Financeiro() {
  const { pode } = useSessao()
  // Cada aba aparece para quem pode ao menos ver aquela parte do financeiro.
  const liberadas: Aba[] = [
    ...(pode('CONTAS_RECEBER_VISUALIZAR', 'CONTAS_RECEBER_BAIXAR') ? (['contas-receber'] as const) : []),
    ...(pode('CONTAS_PAGAR_VISUALIZAR', 'CONTAS_PAGAR_BAIXAR') ? (['contas-pagar'] as const) : []),
    ...(pode('DESPESAS_VISUALIZAR', 'DESPESAS_LANCAR') ? (['despesas'] as const) : []),
    ...(pode('CAIXA_VISUALIZAR', 'CAIXA_MOVIMENTAR', 'CAIXA_LANCAR') ? (['caixa'] as const) : []),
    ...(pode('OFX_IMPORTAR', 'CONCILIACAO_VISUALIZAR', 'CONCILIACAO_CONFIRMAR') ? (['conciliacao'] as const) : []),
  ]
  const [escolhida, setAba] = useState<Aba>('contas-receber')
  const aba = liberadas.includes(escolhida) ? escolhida : liberadas[0]

  // As abas ficam logo abaixo do cabeçalho, que muda conforme a aba.
  const seletor = (
    <div className="abas" role="tablist">
      {liberadas.map((chave) => (
        <button key={chave} type="button" role="tab" aria-selected={aba === chave} onClick={() => setAba(chave)}>
          {rotulosDasAbas[chave]}
        </button>
      ))}
    </div>
  )
  if (!aba) return <p className="aviso">Seu perfil de acesso não inclui o financeiro.</p>
  if (aba === 'despesas') return <Despesas seletor={seletor} />
  if (aba === 'conciliacao') return <Conciliacao seletor={seletor} />
  return aba === 'caixa' ? <CaixaBancos seletor={seletor} /> : <Contas key={aba} aba={aba} seletor={seletor} />
}

// Seletor de pessoa com uma classificação, para os filtros.
function FiltroPessoa(props: { rotulo: string; pessoas: Pessoa[]; classificacao: keyof Pessoa; valor: string; onChange: (v: string) => void }) {
  return (
    <Campo rotulo={props.rotulo}>
      <Escolha
        opcoes={opcoesDePessoas(props.pessoas.filter((p) => p[props.classificacao] || String(p.id) === props.valor))}
        valor={Number(props.valor) || 0}
        onChange={(id) => props.onChange(id ? String(id) : '')}
        nenhum="Todos"
      />
    </Campo>
  )
}

function Contas({ aba, seletor }: { aba: AbaContas; seletor: ReactNode }) {
  const receber = aba === 'contas-receber'
  const [f, setF] = useState({ status: 'ABERTA', pessoaId: '', vendedorId: '', medicoId: '', pacienteId: '', inicio: '', fim: '' })
  const consulta = new URLSearchParams(Object.entries(f).filter(([, valor]) => valor))
  const { dados, erro, carregando, recarregar } = useDados<Conta[]>(`/${aba}?${consulta}`)
  const pessoas = useDados<Pessoa[]>('/pessoas').dados ?? []
  const [lancando, setLancando] = useState(false)
  const [baixando, setBaixando] = useState<Conta | null>(null)
  const [cobranca, setCobranca] = useState(false)
  const [maisFiltros, setMaisFiltros] = useState(false)
  const acao = useAcao()
  const contas = dados ?? []
  const paginas = usePaginacao(contas)
  const config = abas[aba]
  const baixa = useSessao().pode(receber ? 'CONTAS_RECEBER_BAIXAR' : 'CONTAS_PAGAR_BAIXAR')
  const total = contas.filter((c) => c.status === 'ABERTA').reduce((soma, c) => soma + saldoDe(c), 0)
  const vencido = contas.filter(estaVencida).reduce((soma, c) => soma + saldoDe(c), 0)
  const filtrando = [f.pessoaId, f.vendedorId, f.medicoId, f.pacienteId, f.inicio, f.fim].some(Boolean)

  function operar(conta: Conta, operacao: 'estornar' | 'cancelar') {
    const pergunta =
      operacao === 'cancelar' ? `Cancelar "${conta.descricao}"?` : `Estornar a última baixa de "${conta.descricao}"? O valor volta para o saldo da conta.`
    if (!window.confirm(pergunta)) return
    acao.executar(async () => {
      await api(`/${aba}/${conta.id}/${operacao}`, { method: 'POST' })
      recarregar()
    })
  }

  return (
    <>
      <Cabecalho titulo="Financeiro" descricao="Contas a receber e a pagar, com baixas totais ou parciais.">
        {receber && (
          <button type="button" className="botao" onClick={() => setCobranca(true)}>
            Relatório de cobrança
          </button>
        )}
        {baixa && (
          <button type="button" className="botao botao-primario" onClick={() => setLancando(true)}>
            Novo lançamento
          </button>
        )}
      </Cabecalho>
      {seletor}

      <div className="filtros">
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Situação">
          <option value="ABERTA">Em aberto</option>
          <option value="PAGA">Liquidadas</option>
          <option value="CANCELADA">Canceladas</option>
          <option value="">Abertas e liquidadas</option>
        </select>
        <button type="button" className="botao" aria-expanded={maisFiltros} onClick={() => setMaisFiltros(!maisFiltros)}>
          {maisFiltros ? 'Menos filtros' : filtrando ? 'Filtros (ativos)' : 'Mais filtros'}
        </button>
        <span className="resumo-filtro">
          Em aberto: <strong>{brl(total)}</strong>
          {vencido > 0 && <span className="texto-ruim"> · vencido: {brl(vencido)}</span>}
        </span>
      </div>
      {maisFiltros && (
        <section className="painel filtros-relatorio">
          <FiltroPessoa rotulo={config.pessoa} pessoas={pessoas} classificacao={receber ? 'cliente' : 'fornecedor'} valor={f.pessoaId} onChange={(pessoaId) => setF({ ...f, pessoaId })} />
          {receber && (
            <>
              <FiltroPessoa rotulo="Vendedor" pessoas={pessoas} classificacao="vendedor" valor={f.vendedorId} onChange={(vendedorId) => setF({ ...f, vendedorId })} />
              <FiltroPessoa rotulo="Médico" pessoas={pessoas} classificacao="medico" valor={f.medicoId} onChange={(medicoId) => setF({ ...f, medicoId })} />
              <FiltroPessoa rotulo="Paciente" pessoas={pessoas} classificacao="paciente" valor={f.pacienteId} onChange={(pacienteId) => setF({ ...f, pacienteId })} />
            </>
          )}
          <Campo rotulo="Vencimento de">
            <CampoData type="date" value={f.inicio} max={f.fim || undefined} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
          </Campo>
          <Campo rotulo="Até">
            <CampoData type="date" value={f.fim} min={f.inicio || undefined} onChange={(e) => setF({ ...f, fim: e.target.value })} />
          </Campo>
          {filtrando && (
            <button type="button" className="botao botao-texto" onClick={() => setF({ ...f, pessoaId: '', vendedorId: '', medicoId: '', pacienteId: '', inicio: '', fim: '' })}>
              Limpar filtros
            </button>
          )}
        </section>
      )}

      <Erro mensagem={acao.erro} />
      {contas.length >= 500 && (
        <p className="aviso-lista">
          Mostrando as 500 primeiras pelo vencimento. Para achar outras, escolha a pessoa ou o período de vencimento em "Mais filtros".
        </p>
      )}
      <section className="painel">
        <EstadoLista carregando={carregando} erro={erro} vazia={contas.length === 0} textoVazio="Nenhum lançamento para estes filtros." />
        {contas.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Descrição</th>
                <th>{config.pessoa}</th>
                {receber && <th>Venda</th>}
                <th>Situação</th>
                <th className="num">Valor</th>
                <th className="num">Saldo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paginas.visiveis.map((c) => {
                const parcial = c.status === 'ABERTA' && c.valorPago > 0
                return (
                  <tr key={c.id}>
                    <td>{dataBr(c.vencimento)}</td>
                    <td>{c.descricao}</td>
                    <td>{c.pessoa?.nome ?? '—'}</td>
                    {receber && (
                      <td>
                        {c.pedido ? `#${c.pedido.numero}` : '—'}
                        {c.pedido && (c.pedido.vendedor || c.pedido.medico || c.pedido.paciente) && (
                          <small className="bloco texto-suave">
                            {[c.pedido.vendedor && `Vend.: ${c.pedido.vendedor.nome}`, c.pedido.medico && `Méd.: ${c.pedido.medico.nome}`, c.pedido.paciente && `Pac.: ${c.pedido.paciente.nome}`]
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        )}
                      </td>
                    )}
                    <td>
                      {estaVencida(c) ? <Selo valor="VENCIDA" /> : <Selo valor={c.status} />}
                      {parcial && <> <Selo valor="PARCIAL" /></>}
                      {c.pagoEm && <small className="texto-suave"> em {dataBr(c.pagoEm)}</small>}
                    </td>
                    <td className="num">{brl(c.valor)}</td>
                    <td className="num">{c.status === 'ABERTA' ? brl(saldoDe(c)) : '—'}</td>
                    <td className="num">
                      {baixa && c.status === 'ABERTA' && (
                        <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => setBaixando(c)}>
                          {config.baixar}
                        </button>
                      )}
                      {(!baixa || c.status !== 'ABERTA') && c.valorPago > 0 && (
                        <button type="button" className="botao botao-texto" onClick={() => setBaixando(c)}>
                          Histórico
                        </button>
                      )}
                      {baixa && c.status !== 'CANCELADA' && c.valorPago > 0 && (
                        <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => operar(c, 'estornar')}>
                          Estornar
                        </button>
                      )}
                      {baixa && c.status === 'ABERTA' && c.valorPago === 0 && (
                        <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => operar(c, 'cancelar')}>
                          Cancelar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {paginas.controle}
      </section>

      {lancando && (
        <FormConta
          aba={aba}
          onFechar={() => setLancando(false)}
          onSalvo={() => {
            setLancando(false)
            recarregar()
          }}
        />
      )}
      {baixando && (
        <Baixa
          aba={aba}
          conta={baixando}
          onFechar={() => {
            setBaixando(null)
            recarregar()
          }}
        />
      )}
      {cobranca && <Cobranca pessoas={pessoas} onFechar={() => setCobranca(false)} />}
    </>
  )
}

type LinhaCobranca = RelatorioCobranca['linhas'][number]
const colunasCobranca: Coluna<LinhaCobranca>[] = [
  { rotulo: 'Cliente', valor: (l) => l.cliente, largura: 160 },
  { rotulo: 'Contato', valor: (l) => [telefoneBr(l.telefone), l.email].filter(Boolean).join(' · ') || null },
  { rotulo: 'Descrição', valor: (l) => l.descricao, largura: 180 },
  { rotulo: 'Venda', valor: (l) => (l.pedidoNumero ? `#${l.pedidoNumero}` : null) },
  { rotulo: 'Vendedor', valor: (l) => l.vendedor },
  { rotulo: 'Emissão', valor: (l) => l.emissao, tipo: 'data' },
  { rotulo: 'Vencimento', valor: (l) => l.vencimento, tipo: 'data' },
  { rotulo: 'Situação', valor: (l) => l.situacao, exibir: (l) => <Selo valor={l.situacao} /> },
  { rotulo: 'Dias de atraso', valor: (l) => l.diasAtraso, exibir: (l) => (l.diasAtraso > 0 ? <span className="texto-ruim">{l.diasAtraso}</span> : '—') },
  { rotulo: 'Valor', valor: (l) => l.valor, tipo: 'dinheiro' },
  { rotulo: 'Recebido', valor: (l) => l.valorPago, tipo: 'dinheiro' },
  { rotulo: 'Saldo', valor: (l) => l.saldo, tipo: 'dinheiro' },
]
type ProdutoCobranca = RelatorioCobranca['porProduto'][number]
const colunasPorProduto: Coluna<ProdutoCobranca>[] = [
  { rotulo: 'Produto', valor: (g) => g.produto, largura: 200 },
  { rotulo: 'Pedidos', valor: (g) => g.pedidos },
  { rotulo: 'Quantidade', valor: (g) => g.quantidade, exibir: (g) => (g.unidade ? `${g.quantidade.toLocaleString('pt-BR')} ${g.unidade}` : '—') },
  { rotulo: 'Valor das contas', valor: (g) => g.valor, tipo: 'dinheiro' },
  { rotulo: 'Saldo em aberto', valor: (g) => g.saldo, tipo: 'dinheiro' },
]
type ClienteCobranca = RelatorioCobranca['porCliente'][number]
const colunasPorCliente: Coluna<ClienteCobranca>[] = [
  { rotulo: 'Cliente', valor: (g) => g.cliente, largura: 160 },
  { rotulo: 'Contato', valor: (g) => telefoneBr(g.telefone) },
  { rotulo: 'Contas', valor: (g) => g.quantidade },
  { rotulo: 'Maior atraso (dias)', valor: (g) => g.maiorAtraso },
  { rotulo: 'Vencido', valor: (g) => g.vencido, tipo: 'dinheiro' },
  { rotulo: 'Saldo total', valor: (g) => g.saldo, tipo: 'dinheiro' },
]

// Relatório de cobrança: o que há para receber, com o contato do cliente e os dias de atraso.
function Cobranca(props: { pessoas: Pessoa[]; onFechar: () => void }) {
  const [f, setF] = useState({ situacao: 'ABERTAS', vencidas: '1', ate: '', emissaoInicio: '', emissaoFim: '', pessoaId: '', vendedorId: '', medicoId: '', pacienteId: '' })
  // "Só as vencidas" só existe para o que está em aberto.
  const emAberto = f.situacao === 'ABERTAS' || f.situacao === 'PARCIAIS'
  const consulta = new URLSearchParams(
    Object.entries(f).filter(([chave, valor]) => valor && !(chave === 'vencidas' && !emAberto) && !(chave === 'ate' && emAberto && f.vencidas)),
  )
  const { dados, erro, carregando } = useDados<RelatorioCobranca>(`/relatorios/cobranca?${consulta}`)
  const [visao, setVisao] = useState<'clientes' | 'contas' | 'produtos'>('clientes')
  const acao = useAcao()
  const nomesSituacao: Record<string, string> = { ABERTAS: 'em aberto', PARCIAIS: 'com pagamento parcial', PAGAS: 'pagas', CANCELADAS: 'canceladas', TODAS: 'em qualquer situação' }
  const subtitulo = [
    emAberto && f.vencidas ? `Só contas vencidas ${nomesSituacao[f.situacao]}` : `Contas ${nomesSituacao[f.situacao]}`,
    f.ate && !(emAberto && f.vencidas) && `vencimento até ${dataBr(`${f.ate}T12:00:00`)}`,
    (f.emissaoInicio || f.emissaoFim) && `emissão ${f.emissaoInicio ? `de ${dataBr(`${f.emissaoInicio}T12:00:00`)} ` : ''}${f.emissaoFim ? `até ${dataBr(`${f.emissaoFim}T12:00:00`)}` : ''}`,
    `emitido em ${new Date().toLocaleString('pt-BR')}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const totais = (r: RelatorioCobranca): [string, string][] => [
    ['Vencido', brl(r.resumo.vencido)],
    ['A vencer', brl(r.resumo.aVencer)],
    ['Saldo total', brl(r.resumo.saldo)],
  ]

  return (
    <Modal titulo="Relatório de cobrança" onFechar={props.onFechar} largo>
      <div className="form">
        <Campo rotulo="Situação">
          <select value={f.situacao} onChange={(e) => setF({ ...f, situacao: e.target.value })}>
            <option value="ABERTAS">Em aberto</option>
            <option value="PARCIAIS">Com pagamento parcial</option>
            <option value="PAGAS">Pagas</option>
            <option value="CANCELADAS">Canceladas</option>
            <option value="TODAS">Todas</option>
          </select>
        </Campo>
        {emAberto && (
          <Campo rotulo="Contas">
            <select value={f.vencidas ? 'VENCIDAS' : 'TODAS'} onChange={(e) => setF({ ...f, vencidas: e.target.value === 'VENCIDAS' ? '1' : '' })}>
              <option value="VENCIDAS">Só as vencidas</option>
              <option value="TODAS">Vencidas e a vencer</option>
            </select>
          </Campo>
        )}
        <Campo rotulo="Emissão de">
          <CampoData type="date" value={f.emissaoInicio} max={f.emissaoFim || undefined} onChange={(e) => setF({ ...f, emissaoInicio: e.target.value })} />
        </Campo>
        <Campo rotulo="Emissão até">
          <CampoData type="date" value={f.emissaoFim} min={f.emissaoInicio || undefined} onChange={(e) => setF({ ...f, emissaoFim: e.target.value })} />
        </Campo>
        {!(emAberto && f.vencidas) && (
          <Campo rotulo="Vencimento até">
            <CampoData type="date" value={f.ate} onChange={(e) => setF({ ...f, ate: e.target.value })} />
          </Campo>
        )}
        <FiltroPessoa rotulo="Cliente" pessoas={props.pessoas} classificacao="cliente" valor={f.pessoaId} onChange={(pessoaId) => setF({ ...f, pessoaId })} />
        <FiltroPessoa rotulo="Vendedor" pessoas={props.pessoas} classificacao="vendedor" valor={f.vendedorId} onChange={(vendedorId) => setF({ ...f, vendedorId })} />
        <FiltroPessoa rotulo="Médico" pessoas={props.pessoas} classificacao="medico" valor={f.medicoId} onChange={(medicoId) => setF({ ...f, medicoId })} />
        <FiltroPessoa rotulo="Paciente" pessoas={props.pessoas} classificacao="paciente" valor={f.pacienteId} onChange={(pacienteId) => setF({ ...f, pacienteId })} />
      </div>

      {dados && (
        <section className="indicadores">
          <Resumo rotulo="Clientes" valor={String(dados.resumo.clientes)} nota={`${dados.resumo.quantidade} conta(s)`} />
          <Resumo rotulo="Vencido" valor={brl(dados.resumo.vencido)} />
          <Resumo rotulo="A vencer" valor={brl(dados.resumo.aVencer)} />
          <Resumo rotulo="Saldo total" valor={brl(dados.resumo.saldo)} />
          {!emAberto && <Resumo rotulo="Recebido" valor={brl(dados.resumo.recebido)} />}
        </section>
      )}

      <div className="abas" role="tablist">
        <button type="button" role="tab" aria-selected={visao === 'clientes'} onClick={() => setVisao('clientes')}>
          Por cliente
        </button>
        <button type="button" role="tab" aria-selected={visao === 'contas'} onClick={() => setVisao('contas')}>
          Contas
        </button>
        <button type="button" role="tab" aria-selected={visao === 'produtos'} onClick={() => setVisao('produtos')}>
          Por produto
        </button>
      </div>
      {visao === 'produtos' && dados && dados.linhas.length > 0 && (
        <p className="texto-suave">O valor e o saldo de cada conta são divididos entre os produtos do pedido, na proporção do valor de cada um; a quantidade conta uma vez por pedido, na unidade base.</p>
      )}
      <EstadoLista carregando={carregando} erro={erro} vazia={!dados?.linhas.length} textoVazio="Nada a cobrar com estes filtros." />
      {dados && dados.linhas.length > 0 && visao === 'clientes' && <Tabela colunas={colunasPorCliente} linhas={dados.porCliente} chave={(g) => g.cliente} />}
      {dados && dados.linhas.length > 0 && visao === 'contas' && <Tabela colunas={colunasCobranca} linhas={dados.linhas} chave={(l) => l.id} />}
      {dados && dados.linhas.length > 0 && visao === 'produtos' && <Tabela colunas={colunasPorProduto} linhas={dados.porProduto} chave={(g) => g.produto} />}

      <Erro mensagem={acao.erro} />
      <div className="form-pe">
        <button type="button" className="botao" onClick={props.onFechar}>
          Fechar
        </button>
        <button
          type="button"
          className="botao"
          disabled={!dados?.linhas.length}
          onClick={() => dados && (visao === 'produtos' ? exportarCsv('cobranca-por-produto', colunasPorProduto, dados.porProduto) : exportarCsv('cobranca', colunasCobranca, dados.linhas))}
        >
          Exportar para Excel
        </button>
        <button
          type="button"
          className="botao botao-primario"
          disabled={!dados?.linhas.length}
          onClick={() =>
            acao.executar(async () => {
              if (!dados) return
              if (visao === 'clientes') imprimir('Cobrança por cliente', subtitulo, colunasPorCliente, dados.porCliente, totais(dados))
              else if (visao === 'produtos') imprimir('Cobrança por produto', subtitulo, colunasPorProduto, dados.porProduto, totais(dados))
              else imprimir('Cobrança', subtitulo, colunasCobranca, dados.linhas, totais(dados))
            })
          }
        >
          Imprimir ou salvar PDF
        </button>
      </div>
    </Modal>
  )
}

// Recebe ou paga a conta, no todo ou em parte, e mostra o histórico de baixas e estornos.
// Bloco com a origem da conta: pedido, entrada ou despesa, com pessoas, documento e observações.
function OrigemDaConta({ conta }: { conta: ContaComOrigem }) {
  const linhas: [string, string | null | undefined][] = conta.pedido
    ? [
        ['Venda', `Pedido nº ${conta.pedido.numero} de ${dataBr(conta.pedido.data)}${conta.pedido.natureza !== 'VENDA' ? ` (${naturezasPedido[conta.pedido.natureza]})` : ''}`],
        ['Pagamento', conta.pedido.formaPagamento ? (formasPagamento[conta.pedido.formaPagamento] ?? conta.pedido.formaPagamento) : null],
        ['Vendedor', conta.pedido.vendedor?.nome],
        ['Médico', conta.pedido.medico?.nome],
        ['Paciente', conta.pedido.paciente?.nome],
        ['Observação da venda', conta.pedido.observacao],
      ]
    : conta.entrada
      ? [
          ['Entrada de estoque', `nº ${conta.entrada.id} de ${dataBr(conta.entrada.data)}`],
          ['Documento', conta.entrada.numeroDocumento],
        ]
      : conta.despesa
        ? [
            ['Despesa', `nº ${conta.despesa.id} · ${conta.despesa.elemento}: ${conta.despesa.descricao}`],
            ['Emissão', dataBr(conta.despesa.dataEmissao)],
            ['Documento', conta.despesa.numeroDocumento],
            ['Observação', conta.despesa.observacao],
          ]
        : [['Origem', 'Lançamento manual']]
  return (
    <dl className="origem-conta">
      {linhas
        .filter(([, valor]) => valor)
        .map(([rotulo, valor]) => (
          <div key={rotulo}>
            <dt>{rotulo}</dt>
            <dd>{valor}</dd>
          </div>
        ))}
      <div>
        <dt>Lançada em</dt>
        <dd>{dataBr(conta.criadoEm)}</dd>
      </div>
    </dl>
  )
}

function Baixa(props: { aba: AbaContas; conta: Conta; onFechar: () => void }) {
  const config = abas[props.aba]
  const [conta, setConta] = useState(props.conta)
  // Quem só pode ver as contas abre aqui o histórico, sem o formulário de baixa.
  const { pode } = useSessao()
  const podeBaixar = conta.status === 'ABERTA' && pode(props.aba === 'contas-receber' ? 'CONTAS_RECEBER_BAIXAR' : 'CONTAS_PAGAR_BAIXAR')
  const contasFinanceiras = (useDados<ContaFinanceira[]>(podeBaixar ? '/contas-financeiras' : null).dados ?? []).filter((c) => c.ativa)
  const historico = useDados<MovimentoFinanceiro[]>(`/${props.aba}/${conta.id}/baixas`)
  // De onde a conta veio: a venda (a receber) ou a entrada de estoque ou a despesa (a pagar).
  const origem = useDados<ContaComOrigem>(`/${props.aba}/${conta.id}`).dados
  const [contaFinanceiraId, setContaFinanceiraId] = useState(0)
  const [valor, setValor] = useState(saldoDe(props.conta))
  const [quando, setQuando] = useState(agoraLocal())
  const [observacao, setObservacao] = useState('')
  const { erro, ocupado, executar } = useAcao()
  const aberta = conta.status === 'ABERTA'
  // Com uma só conta financeira ativa, ela já vem escolhida.
  const escolhida = contaFinanceiraId || (contasFinanceiras.length === 1 ? contasFinanceiras[0].id : 0)

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      const atualizada = await api<Conta>(`/${props.aba}/${conta.id}/baixar`, {
        body: { valor, data: instante(quando), contaFinanceiraId: escolhida || null, observacao },
      })
      setConta(atualizada)
      setValor(saldoDe(atualizada))
      setObservacao('')
      historico.recarregar()
    })
  }

  return (
    <Modal titulo={`${config.baixa} · ${conta.descricao}`} onFechar={props.onFechar} largo>
      <p>
        {conta.pessoa?.nome ?? `Sem ${config.pessoa.toLowerCase()}`} · vencimento {dataBr(conta.vencimento)} · valor {brl(conta.valor)} · saldo{' '}
        <strong>{brl(aberta ? saldoDe(conta) : 0)}</strong>
      </p>
      {origem && <OrigemDaConta conta={origem} />}
      {podeBaixar && (
        <form onSubmit={enviar} className="form">
          <Campo rotulo="Conta financeira" largura={3}>
            <select required value={escolhida || ''} onChange={(e) => setContaFinanceiraId(Number(e.target.value))}>
              <option value="">Selecione…</option>
              {contasFinanceiras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} · {tiposContaFinanceira[c.tipo] ?? c.tipo}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Valor (R$)">
            <Dinheiro required autoFocus valor={valor} onChange={setValor} />
          </Campo>
          <Campo rotulo="Data e hora">
            <CampoData type="datetime-local" required value={quando} onChange={(e) => setQuando(e.target.value)} />
          </Campo>
          <Campo rotulo="Observação">
            <input value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </Campo>
          {valor > 0 && valor < saldoDe(conta) && (
            <p className="texto-suave col-3">Baixa parcial: a conta continua em aberto com saldo de {brl(saldoDe(conta) - valor)}.</p>
          )}
          <Erro mensagem={erro} />
          <div className="form-pe">
            <button type="button" className="botao" onClick={props.onFechar}>
              Fechar
            </button>
            <button className="botao botao-primario" disabled={ocupado || valor <= 0}>
              {config.baixar}
            </button>
          </div>
        </form>
      )}

      <h3>Documentos da conta</h3>
      <Documentos origem={props.aba === 'contas-receber' ? 'CONTA_RECEBER' : 'CONTA_PAGAR'} origemId={conta.id} />

      <h3>Histórico</h3>
      <EstadoLista carregando={historico.carregando} erro={historico.erro} vazia={(historico.dados ?? []).length === 0} textoVazio="Nenhuma baixa registrada." />
      {(historico.dados ?? []).length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Operação</th>
              <th>Conta financeira</th>
              <th>Observação</th>
              <th>Usuário</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {historico.dados!.map((m) => (
              <tr key={m.id}>
                <td>{dataHoraBr(m.data, m.comHora)}</td>
                <td>
                  {origensMovimento[m.origem] ?? m.origem}
                  {m.estornado && <small className="texto-suave"> (estornado)</small>}
                  {m.extratoId && <small className="bloco texto-suave">conciliado com o banco</small>}
                </td>
                <td>{m.contaFinanceira.nome}</td>
                <td>{m.observacao ?? '—'}</td>
                <td>{m.usuario?.nome ?? '—'}</td>
                <td className="num">{brl(m.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!podeBaixar && (
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Fechar
          </button>
        </div>
      )}
    </Modal>
  )
}

function FormConta(props: { aba: AbaContas; onFechar: () => void; onSalvo: () => void }) {
  const config = abas[props.aba]
  const pessoas = useDados<Pessoa[]>(`/pessoas?classificacao=${config.classificacao}`).dados ?? []
  const [pessoaId, setPessoaId] = useState(0)
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState(0)
  const [vencimento, setVencimento] = useState(hojeIso())
  const { erro, ocupado, executar } = useAcao()

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      await api(`/${props.aba}`, { body: { pessoaId: pessoaId || null, descricao, valor, vencimento } })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={`Novo lançamento · ${config.rotulo.toLowerCase()}`} onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Descrição" largura={3}>
          <input required autoFocus value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </Campo>
        <Campo rotulo={`${config.pessoa} (opcional)`} largura={3}>
          <Escolha opcoes={opcoesDePessoas(pessoas.filter((p) => p.ativo))} valor={pessoaId} onChange={setPessoaId} nenhum="Nenhum" />
        </Campo>
        <Campo rotulo="Valor (R$)">
          <Dinheiro required valor={valor} onChange={setValor} />
        </Campo>
        <Campo rotulo="Vencimento" largura={2}>
          <CampoData type="date" required value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
        </Campo>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            Lançar
          </button>
        </div>
      </form>
    </Modal>
  )
}

// Contas financeiras com o saldo atual e o extrato dos movimentos.
// O extrato exportado para o Excel, com os filtros da tela.
const colunasExtrato: Coluna<MovimentoFinanceiro>[] = [
  { rotulo: 'Data', valor: (m) => m.data, tipo: 'data' },
  { rotulo: 'Conta', valor: (m) => m.contaFinanceira.nome },
  { rotulo: 'Histórico', valor: (m) => m.historico },
  { rotulo: 'Observação', valor: (m) => m.observacao },
  { rotulo: 'Origem', valor: (m) => `${origensMovimento[m.origem] ?? m.origem}${m.estornado ? ' (estornado)' : ''}` },
  { rotulo: 'Entrada', valor: (m) => (m.tipo === 'ENTRADA' ? m.valor : null), tipo: 'dinheiro' },
  { rotulo: 'Saída', valor: (m) => (m.tipo === 'SAIDA' ? m.valor : null), tipo: 'dinheiro' },
  { rotulo: 'Conciliado', valor: (m) => (m.extratoId ? 'Sim' : 'Não') },
  { rotulo: 'Usuário', valor: (m) => m.usuario?.nome ?? null },
]

function CaixaBancos({ seletor }: { seletor: ReactNode }) {
  const { pode } = useSessao()
  const lanca = pode('CAIXA_LANCAR')
  const contas = useDados<ContaFinanceira[]>('/contas-financeiras')
  const [f, setF] = useState({ contaFinanceiraId: '', tipo: '', inicio: '', fim: '' })
  const consulta = new URLSearchParams(Object.entries(f).filter(([, valor]) => valor))
  const extrato = useDados<Extrato>(`/movimentos-financeiros?${consulta}`)
  const [editando, setEditando] = useState<ContaFinanceira | 'nova' | null>(null)
  const [lancando, setLancando] = useState<'avulso' | 'transferencia' | null>(null)
  const acao = useAcao()
  const lista = contas.dados ?? []
  const linhas = extrato.dados?.linhas ?? []
  const paginas = usePaginacao(linhas, 50)
  const resumo = extrato.dados?.resumo

  function atualizar() {
    contas.recarregar()
    extrato.recarregar()
  }

  function estornar(m: MovimentoFinanceiro) {
    const pergunta =
      m.origem === 'TRANSFERENCIA'
        ? `Estornar a transferência de ${brl(m.valor)}? As duas pontas são estornadas.`
        : `Estornar "${m.historico}" (${brl(m.valor)})? O movimento contrário é lançado na conta.`
    if (!window.confirm(pergunta)) return
    acao.executar(async () => {
      await api(`/movimentos-financeiros/${m.id}/estornar`, { method: 'POST' })
      atualizar()
    })
  }

  return (
    <>
      <Cabecalho titulo="Caixa e bancos" descricao="Saldos das contas financeiras e o extrato de entradas e saídas.">
        <button type="button" className="botao" onClick={atualizar}>
          Atualizar
        </button>
        <button type="button" className="botao" onClick={() => exportarCsv('extrato', colunasExtrato, linhas)} disabled={linhas.length === 0}>
          Exportar para Excel
        </button>
        {lanca && (
          <>
            <button type="button" className="botao" onClick={() => setLancando('transferencia')}>
              Transferir entre contas
            </button>
            <button type="button" className="botao" onClick={() => setLancando('avulso')}>
              Lançamento avulso
            </button>
          </>
        )}
        {pode('CAIXA_MOVIMENTAR') && (
          <button type="button" className="botao botao-primario" onClick={() => setEditando('nova')}>
            Nova conta financeira
          </button>
        )}
      </Cabecalho>
      {seletor}

      <EstadoLista carregando={contas.carregando} erro={contas.erro} vazia={lista.length === 0} textoVazio="Nenhuma conta financeira cadastrada." />
      <section className="indicadores">
        {lista.map((c) => (
          <button key={c.id} type="button" className="indicador" onClick={() => pode('CAIXA_MOVIMENTAR') && setEditando(c)} title="Editar conta financeira">
            <span>
              {c.nome}
              {!c.ativa && ' (inativa)'}
            </span>
            <strong className={c.saldo < 0 ? 'texto-ruim' : ''}>{brl(c.saldo)}</strong>
            <small className="texto-suave">{[tiposContaFinanceira[c.tipo] ?? c.tipo, c.instituicao].filter(Boolean).join(' · ')}</small>
          </button>
        ))}
      </section>

      <section className="painel filtros-relatorio">
        <Campo rotulo="Conta">
          <select value={f.contaFinanceiraId} onChange={(e) => setF({ ...f, contaFinanceiraId: e.target.value })}>
            <option value="">Todas as contas</option>
            {lista.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Tipo">
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
            <option value="">Entradas e saídas</option>
            <option value="ENTRADA">Entradas</option>
            <option value="SAIDA">Saídas</option>
          </select>
        </Campo>
        <Campo rotulo="Período inicial">
          <CampoData type="date" value={f.inicio} max={f.fim || undefined} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
        </Campo>
        <Campo rotulo="Período final">
          <CampoData type="date" value={f.fim} min={f.inicio || undefined} onChange={(e) => setF({ ...f, fim: e.target.value })} />
        </Campo>
      </section>

      {resumo && (
        <section className="indicadores">
          <div className="indicador">
            <span>Saldo inicial</span>
            <strong>{brl(resumo.saldoInicial)}</strong>
          </div>
          <div className="indicador">
            <span>Entradas no período</span>
            <strong>{brl(resumo.entradas)}</strong>
          </div>
          <div className="indicador">
            <span>Saídas no período</span>
            <strong>{brl(resumo.saidas)}</strong>
          </div>
          {!f.tipo && (
            <div className="indicador">
              <span>Saldo final</span>
              <strong className={resumo.saldoFinal < 0 ? 'texto-ruim' : ''}>{brl(resumo.saldoFinal)}</strong>
            </div>
          )}
        </section>
      )}

      <Erro mensagem={acao.erro} />
      <section className="painel">
        <EstadoLista carregando={extrato.carregando} erro={extrato.erro} vazia={linhas.length === 0} textoVazio="Nenhuma movimentação para estes filtros." />
        {linhas.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Conta</th>
                <th>Histórico</th>
                <th>Origem</th>
                <th className="num">Entrada</th>
                <th className="num">Saída</th>
                <th>Usuário</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {paginas.visiveis.map((m) => (
                <tr key={m.id}>
                  <td>{dataHoraBr(m.data, m.comHora)}</td>
                  <td>{m.contaFinanceira.nome}</td>
                  <td>
                    {m.historico}
                    {m.observacao && <small className="texto-suave"> · {m.observacao}</small>}
                  </td>
                  <td>
                    {origensMovimento[m.origem] ?? m.origem}
                    {m.estornado && <small className="texto-suave"> (estornado)</small>}
                    {m.extratoId && <small className="bloco texto-suave">conciliado com o banco</small>}
                  </td>
                  <td className="num">{m.tipo === 'ENTRADA' ? brl(m.valor) : '—'}</td>
                  <td className="num">{m.tipo === 'SAIDA' ? brl(m.valor) : '—'}</td>
                  <td>{m.usuario?.nome ?? '—'}</td>
                  <td className="num">
                    {lanca && (m.origem === 'AVULSO' || m.origem === 'TRANSFERENCIA') && !m.estornado && !m.extratoId && (
                      <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => estornar(m)}>
                        Estornar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {paginas.controle}
      </section>

      {editando && (
        <FormContaFinanceira
          conta={editando === 'nova' ? null : editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null)
            atualizar()
          }}
        />
      )}
      {lancando && (
        <LancarNoCaixa
          modo={lancando}
          contas={lista.filter((c) => c.ativa)}
          onFechar={() => setLancando(null)}
          onSalvo={() => {
            setLancando(null)
            atualizar()
          }}
        />
      )}
    </>
  )
}

// Lançamento avulso numa conta (tarifa, rendimento, aporte...) ou transferência entre duas contas próprias.
function LancarNoCaixa(props: { modo: 'avulso' | 'transferencia'; contas: ContaFinanceira[]; onFechar: () => void; onSalvo: () => void }) {
  const transferencia = props.modo === 'transferencia'
  const unica = props.contas.length === 1 ? props.contas[0].id : 0
  const [f, setF] = useState({ contaFinanceiraId: unica, destinoId: 0, tipo: 'SAIDA', historico: '', observacao: '' })
  const [valor, setValor] = useState(0)
  const [quando, setQuando] = useState(agoraLocal())
  const { erro, ocupado, executar } = useAcao()

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      if (transferencia) {
        await api('/transferencias', { body: { origemId: f.contaFinanceiraId, destinoId: f.destinoId, valor, data: instante(quando), historico: f.historico || null } })
      } else {
        await api('/movimentos-financeiros', {
          body: { contaFinanceiraId: f.contaFinanceiraId, tipo: f.tipo, valor, data: instante(quando), historico: f.historico, observacao: f.observacao || null },
        })
      }
      props.onSalvo()
    })
  }

  const seletorConta = (rotulo: string, valorAtual: number, onChange: (id: number) => void, excluir = 0) => (
    <Campo rotulo={rotulo}>
      <select required value={valorAtual || ''} onChange={(e) => onChange(Number(e.target.value))}>
        <option value="">Selecione…</option>
        {props.contas
          .filter((c) => c.id !== excluir)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
      </select>
    </Campo>
  )

  return (
    <Modal titulo={transferencia ? 'Transferir entre contas' : 'Lançamento avulso'} onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        {transferencia ? (
          <>
            {seletorConta('Sai da conta', f.contaFinanceiraId, (contaFinanceiraId) => setF({ ...f, contaFinanceiraId }))}
            {seletorConta('Entra na conta', f.destinoId, (destinoId) => setF({ ...f, destinoId }), f.contaFinanceiraId)}
          </>
        ) : (
          <>
            {seletorConta('Conta', f.contaFinanceiraId, (contaFinanceiraId) => setF({ ...f, contaFinanceiraId }))}
            <Campo rotulo="Tipo">
              <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                <option value="SAIDA">Saída</option>
                <option value="ENTRADA">Entrada</option>
              </select>
            </Campo>
          </>
        )}
        <Campo rotulo="Valor (R$)">
          <Dinheiro required valor={valor} onChange={setValor} />
        </Campo>
        <Campo rotulo="Data e hora">
          <CampoData type="datetime-local" required value={quando} onChange={(e) => setQuando(e.target.value)} />
        </Campo>
        <Campo rotulo={transferencia ? 'Descrição (opcional)' : 'Histórico'} largura={transferencia ? 2 : 3}>
          <input
            required={!transferencia}
            value={f.historico}
            onChange={(e) => setF({ ...f, historico: e.target.value })}
            placeholder={transferencia ? 'Ex.: reserva para impostos' : 'Ex.: tarifa bancária, rendimento, aporte dos sócios'}
          />
        </Campo>
        {!transferencia && (
          <Campo rotulo="Observação (opcional)" largura={3}>
            <input value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} />
          </Campo>
        )}
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado || valor <= 0}>
            {transferencia ? 'Transferir' : 'Lançar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function FormContaFinanceira(props: { conta: ContaFinanceira | null; onFechar: () => void; onSalvo: () => void }) {
  const { conta } = props
  const [f, setF] = useState({
    nome: conta?.nome ?? '',
    tipo: conta?.tipo ?? 'CONTA_CORRENTE',
    instituicao: conta?.instituicao ?? '',
    codigoBanco: conta?.codigoBanco ?? '',
    agencia: conta?.agencia ?? '',
    numeroConta: conta?.numeroConta ?? '',
    documentoTitular: conta?.documentoTitular ?? '',
    saldoInicial: conta?.saldoInicial ?? 0,
    ativa: conta?.ativa ?? true,
  })
  const { erro, ocupado, executar } = useAcao()
  const banco = f.tipo !== 'CAIXA'
  // O banco escolhido na lista; "outro" libera a digitação da instituição e do código.
  const daLista = BANCOS.find((b) => b.codigo === f.codigoBanco && b.nome === f.instituicao)
  const [outroBanco, setOutroBanco] = useState(!!conta?.instituicao && !daLista)

  function escolherBanco(valor: string) {
    if (valor === 'OUTRO') return setOutroBanco(true)
    setOutroBanco(false)
    const escolhido = BANCOS.find((b) => b.codigo === valor)
    setF({ ...f, codigoBanco: escolhido?.codigo ?? '', instituicao: escolhido?.nome ?? '' })
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      await api(conta ? `/contas-financeiras/${conta.id}` : '/contas-financeiras', { method: conta ? 'PUT' : 'POST', body: f })
      props.onSalvo()
    })
  }

  return (
    <Modal titulo={conta ? `Conta financeira · ${conta.nome}` : 'Nova conta financeira'} onFechar={props.onFechar}>
      <form onSubmit={enviar} className="form">
        <Campo rotulo="Nome" largura={2}>
          <input required autoFocus value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </Campo>
        <Campo rotulo="Tipo">
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as ContaFinanceira['tipo'] })}>
            {Object.entries(tiposContaFinanceira).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </Campo>
        {banco && (
          <>
            <Campo rotulo="Banco" largura={outroBanco ? 1 : 3}>
              <select value={outroBanco ? 'OUTRO' : (daLista?.codigo ?? '')} onChange={(e) => escolherBanco(e.target.value)}>
                <option value="">Selecione…</option>
                {BANCOS.map((b) => (
                  <option key={b.codigo} value={b.codigo}>
                    {b.codigo} · {b.nome}
                  </option>
                ))}
                <option value="OUTRO">Outro banco…</option>
              </select>
            </Campo>
            {outroBanco && (
              <>
                <Campo rotulo="Instituição financeira">
                  <input required value={f.instituicao} onChange={(e) => setF({ ...f, instituicao: e.target.value })} />
                </Campo>
                <Campo rotulo="Código do banco">
                  <input value={f.codigoBanco} inputMode="numeric" onChange={(e) => setF({ ...f, codigoBanco: e.target.value })} />
                </Campo>
              </>
            )}
            <Campo rotulo="Agência">
              <input value={f.agencia} onChange={(e) => setF({ ...f, agencia: e.target.value })} />
            </Campo>
            <Campo rotulo="Número da conta">
              <input value={f.numeroConta} onChange={(e) => setF({ ...f, numeroConta: e.target.value })} />
            </Campo>
            <Campo rotulo="CPF ou CNPJ do titular">
              <input required inputMode="numeric" value={mascaraDocumento(f.documentoTitular)} onChange={(e) => setF({ ...f, documentoTitular: mascaraDocumento(e.target.value) })} />
            </Campo>
          </>
        )}
        <Campo rotulo="Saldo inicial (R$)">
          <Dinheiro negativo valor={f.saldoInicial} onChange={(saldoInicial) => setF({ ...f, saldoInicial })} />
        </Campo>
        <p className="texto-suave col-2">Use o sinal de menos para uma conta que começa negativa (cheque especial).</p>
        <label className="marcar col-3">
          <input type="checkbox" checked={f.ativa} onChange={(e) => setF({ ...f, ativa: e.target.checked })} />
          Ativa (aparece para receber e pagar)
        </label>
        <Erro mensagem={erro} />
        <div className="form-pe">
          <button type="button" className="botao" onClick={props.onFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={ocupado}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  )
}

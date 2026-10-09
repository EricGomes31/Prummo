import { useState, type FormEvent } from 'react'
import { anexar, api, TAMANHO_MAXIMO_ANEXO, TIPOS_DE_ANEXO, useAcao, useDados } from '../api'
import { useSessao } from '../auth'
import { Documentos } from '../Documentos'
import { brl, dataBr, hojeIso, inteiro, unidadesDe } from '../format'
import type { Entrada, ItemEdicao, Pessoa, Produto, EntradaDetalhada } from '../types'
import { Cabecalho, Campo, Dinheiro, Erro, EstadoLista, Modal, Selo, totalItens, useAtrasado, useOrdenacao, usePaginacao } from '../ui'
import { Icone } from '../icones'
import { CampoData } from '../calendario'
import { Escolha, opcoesDePessoas } from '../escolha'
import { dividirParcelas, somaParcelas, TabelaParcelas, type Parcela } from '../parcelas'

const naturezas = { COMPRA_REVENDA: 'Compra para revenda', BONIFICACAO: 'Bonificação' } as const
type Natureza = keyof typeof naturezas

// Prazos das parcelas em dias a partir da data da entrada.
const condicoes: [string, string][] = [
  ['0', 'À vista'],
  ['7', '7 dias'],
  ['14', '14 dias'],
  ['28', '28 dias'],
  ['30', '30 dias'],
  ['30/60', '30 e 60 dias'],
  ['30/60/90', '30, 60 e 90 dias'],
  ['28/56/84', '28, 56 e 84 dias'],
]
// Valor da condição que abre a tabela de parcelas escolhidas à mão.
const MANUAL = 'MANUAL'
const somarDias = (dia: string, dias: number) => {
  const d = new Date(`${dia}T12:00:00`)
  d.setDate(d.getDate() + dias)
  return d.toLocaleDateString('sv-SE')
}
const rotuloCondicao = (c: string | null) => (c === null ? '—' : (condicoes.find(([valor]) => valor === c)?.[1] ?? `${c} dias`))

export function Entradas() {
  const [filtro, setFiltro] = useState({ busca: '', inicio: '', fim: '' })
  const busca = useAtrasado(filtro.busca.trim())
  const consulta = new URLSearchParams(Object.entries({ busca, inicio: filtro.inicio, fim: filtro.fim }).filter(([, v]) => v)).toString()
  const { dados, erro, carregando, recarregar } = useDados<Entrada[]>(`/entradas${consulta ? `?${consulta}` : ''}`)
  const filtrando = !!consulta
  const [lancando, setLancando] = useState(false)
  const [vendo, setVendo] = useState<Entrada | null>(null)
  const entradas = dados ?? []
  const { ordenados, titulo } = useOrdenacao(entradas, {
    numero: (e) => e.id,
    data: (e) => e.data,
    fornecedor: (e) => e.fornecedor?.nome,
    natureza: (e) => naturezas[e.natureza],
    documento: (e) => e.numeroDocumento,
    pagamento: (e) => rotuloCondicao(e.condicaoPagamento),
    total: (e) => e.total,
  })
  const paginas = usePaginacao(ordenados)
  const { pode } = useSessao()

  return (
    <>
      <Cabecalho titulo="Entradas de estoque" descricao="Compras para revenda e bonificações.">
        {pode('ESTOQUE_ENTRADA') && (
          <button type="button" className="botao botao-primario" onClick={() => setLancando(true)}>
            Nova entrada
          </button>
        )}
      </Cabecalho>

      <div className="filtros">
        <input
          type="search"
          value={filtro.busca}
          onChange={(e) => setFiltro({ ...filtro, busca: e.target.value })}
          placeholder="Número, fornecedor, documento ou produto"
          aria-label="Buscar entrada"
        />
        <CampoData type="date" className="filtro-data" value={filtro.inicio} max={filtro.fim || undefined} aria-label="Entradas a partir de"
          onChange={(e) => setFiltro({ ...filtro, inicio: e.target.value })} />
        <CampoData type="date" className="filtro-data" value={filtro.fim} min={filtro.inicio || undefined} aria-label="Entradas até"
          onChange={(e) => setFiltro({ ...filtro, fim: e.target.value })} />
        {filtrando && (
          <button type="button" className="botao botao-texto" onClick={() => setFiltro({ busca: '', inicio: '', fim: '' })}>
            Limpar
          </button>
        )}
      </div>
      {entradas.length >= 200 && (
        <p className="aviso-lista">
          Mostrando as 200 entradas mais recentes{filtrando ? ' que atendem à busca' : ''}. Para achar outras, busque pelo fornecedor, documento ou produto, ou escolha um período.
        </p>
      )}

      <section className="painel">
        <EstadoLista carregando={carregando} erro={erro} vazia={entradas.length === 0} textoVazio={filtrando ? 'Nenhuma entrada atende à busca.' : 'Nenhuma entrada lançada.'} />
        {entradas.length > 0 && (
          <table>
            <thead>
              <tr>
                {titulo('numero', 'Nº')}
                {titulo('data', 'Data')}
                {titulo('fornecedor', 'Fornecedor')}
                {titulo('natureza', 'Natureza')}
                {titulo('documento', 'Documento')}
                {titulo('pagamento', 'Pagamento')}
                <th>Itens</th>
                {titulo('total', 'Total', 'num')}
                <th />
              </tr>
            </thead>
            <tbody>
              {paginas.visiveis.map((e) => (
                <tr key={e.id}>
                  <td className="texto-suave">#{e.id}</td>
                  <td>{dataBr(e.data)}</td>
                  <td>{e.fornecedor?.nome ?? '—'}</td>
                  <td>{naturezas[e.natureza]}</td>
                  <td>
                    {e.numeroDocumento ?? '—'}
                    {e.cfop && <small className="bloco texto-suave">CFOP {e.cfop}</small>}
                  </td>
                  <td>{rotuloCondicao(e.condicaoPagamento)}</td>
                  <td>{e.itens.map((i) => `${i.quantidade} ${i.unidade ?? i.produto.unidade} de ${i.produto.nome}`).join(', ')}</td>
                  <td className="num">
                    {brl(e.total)}
                    {e.frete + e.outrasDespesas > 0 && (
                      <small className="bloco texto-suave">inclui {brl(e.frete + e.outrasDespesas)} de frete e despesas</small>
                    )}
                  </td>
                  <td className="num">
                    <button type="button" className="botao botao-texto" onClick={() => setVendo(e)}>
                      Detalhes
                    </button>
                    {e.documentos > 0 && <small className="bloco texto-suave">{e.documentos} documento(s)</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {paginas.controle}
      </section>

      {vendo && <DetalhesEntrada id={vendo.id} onFechar={() => setVendo(null)} onAlterado={recarregar} />}
      {lancando && (
        <FormEntrada
          onFechar={() => setLancando(false)}
          onSalvo={() => {
            setLancando(false)
            recarregar()
          }}
        />
      )}
    </>
  )
}

function FormEntrada(props: { onFechar: () => void; onSalvo: () => void }) {
  // Só produtos ativos que controlam estoque recebem entrada.
  const produtos = (useDados<Produto[]>('/produtos').dados ?? []).filter((p) => p.controlaEstoque && p.ativo)
  const fornecedores = useDados<Pessoa[]>('/pessoas?classificacao=fornecedor').dados ?? []
  const [f, setF] = useState({
    fornecedorId: 0, natureza: 'COMPRA_REVENDA' as Natureza, data: hojeIso(), condicaoPagamento: '', numeroDocumento: '',
    frete: 0, outrasDespesas: 0, cfop: '',
  })
  const [itens, setItens] = useState<ItemEdicao[]>([])
  const [arquivos, setArquivos] = useState<File[]>([])
  const grandes = arquivos.filter((a) => a.size > TAMANHO_MAXIMO_ANEXO)
  const { erro, ocupado, executar } = useAcao()
  const compra = f.natureza === 'COMPRA_REVENDA'
  const somaItens = totalItens(itens)
  const total = somaItens + f.frete + f.outrasDespesas
  // "Escolher datas e valores": as parcelas da tabela no lugar dos prazos fixos.
  const manual = compra && f.condicaoPagamento === MANUAL
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const parcelasNaoFecham = manual && somaParcelas(parcelas) !== total

  function enviar(e: FormEvent) {
    e.preventDefault()
    executar(async () => {
      if (itens.length === 0) throw new Error('Adicione ao menos um produto à entrada.')
      if (grandes.length > 0) throw new Error(`Arquivo acima de 10 MB: ${grandes.map((a) => a.name).join(', ')}.`)
      const entrada = await api<Entrada>('/entradas', {
        body: {
          ...f,
          fornecedorId: f.fornecedorId || null,
          condicaoPagamento: compra && !manual ? f.condicaoPagamento : null,
          parcelas: manual ? parcelas : null,
          itens: itens.map((i) => ({ produtoId: i.produtoId, unidade: i.unidade, quantidade: i.quantidade, custoUnitario: i.valor })),
        },
      })
      // A entrada já está gravada. Se um anexo falhar, avisa e segue: reenviar o formulário duplicaria a entrada.
      const falhas: string[] = []
      for (const arquivo of arquivos) {
        await anexar('ENTRADA_ESTOQUE', entrada.id, arquivo).catch((e: Error) => falhas.push(`${arquivo.name}: ${e.message}`))
      }
      if (falhas.length > 0) {
        window.alert(`A entrada nº ${entrada.id} foi registrada, mas estes documentos não foram anexados:\n\n${falhas.join('\n')}\n\nAnexe de novo pelo botão "Documentos" da entrada.`)
      }
      props.onSalvo()
    })
  }

  return (
    <Modal titulo="Nova entrada de estoque" onFechar={props.onFechar} largo>
      <form onSubmit={enviar} className="form" id="form-entrada">
        <Campo rotulo="Fornecedor" largura={3}>
          <Escolha required opcoes={opcoesDePessoas(fornecedores.filter((p) => p.ativo))} valor={f.fornecedorId} onChange={(id) => setF({ ...f, fornecedorId: id })} placeholder="Digite o nome ou o CNPJ do fornecedor…" />
        </Campo>
        <Campo rotulo="Natureza da operação">
          <select value={f.natureza} onChange={(e) => setF({ ...f, natureza: e.target.value as Natureza })}>
            {Object.entries(naturezas).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Data da entrada">
          <CampoData type="date" required value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </Campo>
        <Campo rotulo="Condição de pagamento">
          <select
            required={compra}
            disabled={!compra}
            value={compra ? f.condicaoPagamento : ''}
            onChange={(e) => {
              setF({ ...f, condicaoPagamento: e.target.value })
              // Ao escolher as parcelas à mão, a tabela começa com uma parcela de 30 dias com o total.
              if (e.target.value === MANUAL && parcelas.length === 0) setParcelas(dividirParcelas(total, 1, somarDias(f.data, 30)))
            }}
          >
            <option value="">{compra ? 'Selecione' : 'Não se aplica'}</option>
            {condicoes.map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
            <option value={MANUAL}>Escolher datas e valores…</option>
          </select>
        </Campo>
        <Campo rotulo="Nº do documento">
          <input placeholder="Número da nota ou documento" value={f.numeroDocumento} onChange={(e) => setF({ ...f, numeroDocumento: e.target.value })} />
        </Campo>
        <Campo rotulo="CFOP">
          <input inputMode="numeric" maxLength={4} placeholder="Ex.: 1102" value={f.cfop} onChange={(e) => setF({ ...f, cfop: e.target.value.replace(/\D/g, '') })} />
        </Campo>
        <span />
        <Campo rotulo="Frete (R$)">
          <Dinheiro valor={f.frete} onChange={(frete) => setF({ ...f, frete })} />
        </Campo>
        <Campo rotulo="Outras despesas (R$)">
          <Dinheiro valor={f.outrasDespesas} onChange={(outrasDespesas) => setF({ ...f, outrasDespesas })} />
        </Campo>
        <Campo rotulo="Documentos da entrada (até 10 MB cada)" largura={3}>
          <input type="file" multiple accept={TIPOS_DE_ANEXO} onChange={(e) => setArquivos([...(e.target.files ?? [])])} />
          {arquivos.length > 0 && (
            <small className={grandes.length > 0 ? 'texto-ruim' : 'texto-suave'}>
              {grandes.length > 0
                ? `Acima de 10 MB: ${grandes.map((a) => a.name).join(', ')}`
                : `${arquivos.length} arquivo(s) serão anexados ao registrar a entrada.`}
            </small>
          )}
        </Campo>
      </form>

      <h3>Itens da entrada</h3>
      <AdicionarItem produtos={produtos.filter((p) => !itens.some((i) => i.produtoId === p.id))} onAdicionar={(item) => setItens([...itens, item])} />
      {itens.length === 0 ? (
        <p className="aviso">Nenhum produto adicionado à entrada.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Descrição</th>
              <th className="num">Quantidade</th>
              <th className="num">Valor unitário</th>
              <th className="num">Valor total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => {
              const produto = produtos.find((p) => p.id === item.produtoId)
              return (
                <tr key={item.produtoId}>
                  <td className="texto-suave">{produto?.sku}</td>
                  <td>{produto?.nome}</td>
                  <td className="num">
                    {item.quantidade} {item.unidade}
                  </td>
                  <td className="num">{brl(item.valor)}</td>
                  <td className="num">{brl(item.quantidade * item.valor)}</td>
                  <td className="num">
                    <button type="button" className="botao-icone" aria-label={`Remover ${produto?.nome}`}
                      onClick={() => setItens(itens.filter((i) => i.produtoId !== item.produtoId))}>
                      <Icone nome="fechar" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <dl className="totais">
        <dt>Itens</dt>
        <dd>{brl(somaItens)}</dd>
        <dt>Frete</dt>
        <dd>{brl(f.frete)}</dd>
        <dt>Outras despesas</dt>
        <dd>{brl(f.outrasDespesas)}</dd>
        <dt className="totais-final">Total da entrada</dt>
        <dd className="totais-final">{brl(total)}</dd>
      </dl>
      {manual && (
        <>
          <h3>Parcelas a pagar</h3>
          <TabelaParcelas parcelas={parcelas} onChange={setParcelas} total={total} rotuloTotal="o total da entrada" />
        </>
      )}
      <p className="texto-suave">
        {compra
          ? 'A entrada soma ao saldo, atualiza o custo dos produtos (com o frete e as outras despesas rateados pelo valor de cada item) e gera as contas a pagar conforme a condição de pagamento.'
          : 'A bonificação soma ao saldo sem alterar o custo dos produtos e não gera conta a pagar.'}
      </p>
      <Erro mensagem={erro} />
      <div className="form-pe">
        <button type="button" className="botao" onClick={props.onFechar}>
          Cancelar
        </button>
        <button form="form-entrada" className="botao botao-primario" disabled={ocupado || parcelasNaoFecham}>
          Registrar entrada
        </button>
      </div>
    </Modal>
  )
}

// A entrada inteira: dados, itens com o custo rateado, totais, parcelas a pagar e documentos.
function DetalhesEntrada(props: { id: number; onFechar: () => void; onAlterado: () => void }) {
  const { dados: e, erro, carregando } = useDados<EntradaDetalhada>(`/entradas/${props.id}`)
  const somaItens = e ? e.itens.reduce((s, i) => s + i.quantidade * i.custoUnitario, 0) : 0
  const rateia = !!e && e.natureza === 'COMPRA_REVENDA' && e.frete + e.outrasDespesas > 0

  return (
    <Modal titulo={`Entrada de estoque nº ${props.id}`} onFechar={props.onFechar} largo>
      <EstadoLista carregando={carregando} erro={erro} vazia={!e} textoVazio="" />
      {e && (
        <>
          <dl className="origem-conta">
            <div>
              <dt>Fornecedor</dt>
              <dd>{e.fornecedor?.nome ?? '—'}</dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>{dataBr(e.data)}</dd>
            </div>
            <div>
              <dt>Natureza</dt>
              <dd>{naturezas[e.natureza]}</dd>
            </div>
            <div>
              <dt>Pagamento</dt>
              <dd>{rotuloCondicao(e.condicaoPagamento)}</dd>
            </div>
            <div>
              <dt>Documento</dt>
              <dd>{e.numeroDocumento ?? '—'}</dd>
            </div>
            {e.cfop && (
              <div>
                <dt>CFOP</dt>
                <dd>{e.cfop}</dd>
              </div>
            )}
          </dl>
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th className="num">Quantidade</th>
                <th className="num">Custo informado</th>
                {rateia && <th className="num">Custo com frete</th>}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {e.itens.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.produto.nome}
                    <small className="bloco texto-suave">{i.produto.sku}</small>
                  </td>
                  <td className="num">
                    {i.quantidade} {i.unidade ?? i.produto.unidade}
                  </td>
                  <td className="num">{brl(i.custoUnitario)}</td>
                  {rateia && <td className="num">{brl(i.custoComRateio)}</td>}
                  <td className="num">{brl(i.quantidade * i.custoUnitario)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="totais">
            <dt>Itens</dt>
            <dd>{brl(somaItens)}</dd>
            <dt>Frete</dt>
            <dd>{brl(e.frete)}</dd>
            <dt>Outras despesas</dt>
            <dd>{brl(e.outrasDespesas)}</dd>
            <dt className="totais-final">Total da entrada</dt>
            <dd className="totais-final">{brl(e.total)}</dd>
          </dl>
          {rateia && <p className="texto-suave">O frete e as outras despesas entram no custo de cada produto, na proporção do valor dele na entrada.</p>}

          {e.contasPagar.length > 0 && (
            <>
              <h3>Parcelas a pagar</h3>
              <table>
                <tbody>
                  {e.contasPagar.map((c) => (
                    <tr key={c.id}>
                      <td>{c.descricao}</td>
                      <td>{dataBr(c.vencimento)}</td>
                      <td>
                        <Selo valor={c.status} />
                      </td>
                      <td className="num">{brl(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3>Documentos</h3>
          <Documentos origem="ENTRADA_ESTOQUE" origemId={e.id} onAlterado={props.onAlterado} />
          <div className="form-pe">
            <button type="button" className="botao" onClick={props.onFechar}>
              Fechar
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

// Busca o produto por código, descrição ou EAN e monta a linha a ser incluída na entrada.
function AdicionarItem(props: { produtos: Produto[]; onAdicionar: (item: ItemEdicao) => void }) {
  const [busca, setBusca] = useState('')
  const [produto, setProduto] = useState<Produto | null>(null)
  const [unidade, setUnidade] = useState('')
  const [quantidade, setQuantidade] = useState(1)
  const [valor, setValor] = useState(0)
  const opcoes = produto ? unidadesDe(produto) : []
  const termo = busca.trim().toLowerCase()
  const achados = termo && !produto
    ? props.produtos.filter((p) => [p.sku, p.nome, p.ean ?? ''].some((campo) => campo.toLowerCase().includes(termo))).slice(0, 8)
    : []

  function escolher(p: Produto) {
    setProduto(p)
    setBusca(`${p.sku} · ${p.nome}`)
    setUnidade(p.unidade)
    setValor(p.precoCusto)
  }

  // Quantidade e valor são sempre da unidade escolhida; ao trocá-la, o custo sugerido acompanha.
  function trocarUnidade(sigla: string) {
    setUnidade(sigla)
    setValor(opcoes.find((u) => u.sigla === sigla)?.precoCusto ?? 0)
  }

  function adicionar() {
    if (!produto || quantidade < 1) return
    props.onAdicionar({ produtoId: produto.id, unidade, quantidade, valor })
    setProduto(null)
    setUnidade('')
    setBusca('')
    setQuantidade(1)
    setValor(0)
  }

  return (
    <div className="adicionar-item">
      <div className="campo busca-produto">
        <span>Produto</span>
        <input
          type="search"
          role="combobox"
          aria-expanded={achados.length > 0}
          aria-controls="achados-produto"
          aria-label="Produto"
          placeholder="Digite o código, a descrição ou o EAN"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value)
            setProduto(null)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            if (!produto && achados.length === 1) escolher(achados[0])
            else adicionar()
          }}
        />
        {achados.length > 0 && (
          <ul id="achados-produto" className="achados" role="listbox">
            {achados.map((p) => (
              <li key={p.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => escolher(p)}>
                  <span className="texto-suave">{p.sku}</span> {p.nome}
                  {p.ean && <small className="texto-suave"> · EAN {p.ean}</small>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {termo && !produto && achados.length === 0 && <small className="texto-suave">Nenhum produto encontrado.</small>}
      </div>
      <Campo rotulo="Unidade">
        <select disabled={opcoes.length < 2} value={unidade} onChange={(e) => trocarUnidade(e.target.value)}>
          {opcoes.length === 0 && <option value="">—</option>}
          {opcoes.map((u) => (
            <option key={u.sigla} value={u.sigla}>
              {u.sigla}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Quantidade">
        <input type="number" min={1} value={quantidade || ''} onChange={(e) => setQuantidade(inteiro(e.target.value))} />
      </Campo>
      <Campo rotulo="Valor unitário (R$)">
        <Dinheiro valor={valor} onChange={setValor} />
      </Campo>
      <button type="button" className="botao" disabled={!produto || quantidade < 1} onClick={adicionar}>
        + Adicionar
      </button>
      {opcoes.length > 1 && (
        <small className="texto-suave adicionar-nota">
          Quantidade e valor devem corresponder à unidade selecionada. O estoque e o custo ficam em {produto?.unidade}.
        </small>
      )}
    </div>
  )
}

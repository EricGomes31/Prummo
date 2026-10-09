import { useRef } from 'react'
import { anexar, api, baixar, TIPOS_DE_ANEXO, useAcao, useDados } from './api'
import { dataBr } from './format'
import { Erro, EstadoLista } from './ui'

export type Origem = 'ENTRADA_ESTOQUE' | 'PEDIDO' | 'CONTA_PAGAR' | 'CONTA_RECEBER' | 'DESPESA' | 'ENTREGA'
type Documento = { id: number; nome: string; tamanho: number; criadoEm: string }

const tamanhoTexto = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`

// Lista os anexos de um registro e permite baixar, remover e incluir outros.
export function Documentos(props: { origem: Origem; origemId: number; onAlterado?: () => void }) {
  const { dados, erro, carregando, recarregar } = useDados<Documento[]>(`/documentos/${props.origem}/${props.origemId}`)
  const acao = useAcao()
  const seletor = useRef<HTMLInputElement>(null)
  const documentos = dados ?? []

  const depois = () => {
    recarregar()
    props.onAlterado?.()
  }

  function incluir(arquivos: FileList | null) {
    if (!arquivos?.length) return
    acao.executar(async () => {
      try {
        for (const arquivo of arquivos) await anexar(props.origem, props.origemId, arquivo)
      } finally {
        // Mesmo se um arquivo falhar, os anteriores já foram gravados.
        if (seletor.current) seletor.current.value = ''
        depois()
      }
    })
  }

  function remover(d: Documento) {
    if (!window.confirm(`Remover "${d.nome}"?`)) return
    acao.executar(async () => {
      await api(`/documentos/arquivo/${d.id}`, { method: 'DELETE' })
      depois()
    })
  }

  return (
    <div className="documentos">
      <EstadoLista carregando={carregando} erro={erro} vazia={documentos.length === 0} textoVazio="Nenhum documento anexado." />
      {documentos.length > 0 && (
        <table>
          <tbody>
            {documentos.map((d) => (
              <tr key={d.id}>
                <td>{d.nome}</td>
                <td className="texto-suave sem-quebra">{tamanhoTexto(d.tamanho)}</td>
                <td className="texto-suave">{dataBr(d.criadoEm)}</td>
                <td className="num">
                  <button type="button" className="botao botao-texto" disabled={acao.ocupado}
                    onClick={() => acao.executar(() => baixar(`/documentos/arquivo/${d.id}`, d.nome))}>
                    Baixar
                  </button>
                  <button type="button" className="botao botao-texto" disabled={acao.ocupado} onClick={() => remover(d)}>
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Erro mensagem={acao.erro} />
      <label className="campo">
        <span>{acao.ocupado ? 'Enviando…' : 'Anexar arquivos (até 10 MB cada)'}</span>
        <input ref={seletor} type="file" multiple accept={TIPOS_DE_ANEXO} disabled={acao.ocupado} onChange={(e) => incluir(e.target.files)} />
      </label>
    </div>
  )
}

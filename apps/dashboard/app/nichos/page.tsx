'use client';

import {
  Check,
  Edit3,
  Eye,
  Filter,
  Pause,
  Play,
  Plus,
  Save,
  Tags,
  X,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  createCommercialNiche,
  listCommercialCampaigns,
  listCommercialNiches,
  listShopeeCategories,
  previewCommercialNiche,
  updateCommercialNiche,
  type CommercialCampaign,
  type CommercialNiche,
  type CommercialNicheInput,
  type CommercialNichePreviewReport,
  type ShopeeCategory,
} from '../../lib/api';
import {
  OpsBadge,
  OpsEmpty,
  OpsLoading,
  OpsPageHeading,
  OpsSection,
  OpsState,
} from '../../components/ops-components';
import { formatCurrency, formatNumber, formatPercent } from '../../lib/format';

type NicheForm = CommercialNicheInput & { id?: string };

const emptyForm = (): NicheForm => ({
  name: '',
  active: true,
  categoryIds: [],
  includeKeywords: [],
  excludeKeywords: [],
  minPrice: null,
  maxPrice: null,
  minDiscountRate: 5,
  minRating: 0,
  minSales: 0,
  minCommissionRate: 0,
  minimumScore: 60,
});

const formFromNiche = (niche: CommercialNiche): NicheForm => ({
  id: niche.id,
  name: niche.name,
  active: niche.active,
  categoryIds: [...niche.categoryIds],
  includeKeywords: [...niche.includeKeywords],
  excludeKeywords: [...niche.excludeKeywords],
  minPrice: niche.minPrice,
  maxPrice: niche.maxPrice,
  minDiscountRate: niche.minDiscountRate,
  minRating: niche.minRating,
  minSales: niche.minSales,
  minCommissionRate: niche.minCommissionRate,
  minimumScore: niche.minimumScore,
});

const numberValue = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const inputFromForm = (form: NicheForm): CommercialNicheInput => ({
  name: form.name,
  active: form.active,
  categoryIds: form.categoryIds,
  includeKeywords: form.includeKeywords,
  excludeKeywords: form.excludeKeywords,
  minPrice: form.minPrice?.trim() || null,
  maxPrice: form.maxPrice?.trim() || null,
  minDiscountRate: form.minDiscountRate,
  minRating: form.minRating,
  minSales: form.minSales,
  minCommissionRate: form.minCommissionRate,
  minimumScore: form.minimumScore,
});

const validateForm = (form: NicheForm) => {
  if (form.name.trim().length < 2) return 'Informe um nome de nicho válido.';
  const min = form.minPrice ? numberValue(form.minPrice) : null;
  const max = form.maxPrice ? numberValue(form.maxPrice) : null;
  if (form.minPrice && min === null) return 'O preço mínimo é inválido.';
  if (form.maxPrice && max === null) return 'O preço máximo é inválido.';
  if (min !== null && max !== null && min > max) {
    return 'O preço mínimo não pode superar o preço máximo.';
  }
  if (
    ![form.minDiscountRate, form.minRating, form.minSales, form.minCommissionRate, form.minimumScore].every(
      (value) => Number.isFinite(value),
    )
  ) {
    return 'Confira os filtros numéricos do nicho.';
  }
  if (form.minDiscountRate < 0 || form.minDiscountRate > 100) {
    return 'O desconto mínimo deve estar entre 0% e 100%.';
  }
  if (form.minCommissionRate < 0 || form.minCommissionRate > 100) {
    return 'A comissão mínima deve estar entre 0% e 100%.';
  }
  if (form.minRating < 0 || form.minRating > 5) {
    return 'A avaliação mínima deve estar entre 0 e 5.';
  }
  if (form.minimumScore < 0 || form.minimumScore > 100) {
    return 'O score mínimo deve estar entre 0 e 100.';
  }
  if (!Number.isInteger(form.minSales) || form.minSales < 0) {
    return 'As vendas mínimas devem ser um número inteiro não negativo.';
  }
  return null;
};

const categoryLabel = (category: ShopeeCategory | undefined) => {
  if (!category) return 'Categoria não disponível';
  const name = category.name?.trim();
  if (name) return name;
  const label = category.displayLabel?.trim();
  return label && !label.includes(category.id)
    ? label
    : 'Categoria não disponível';
};

const rejectionLabels: Record<string, string> = {
  CATEGORY_NOT_INCLUDED: 'Categoria não selecionada',
  INCLUDE_KEYWORD_NOT_MATCHED: 'Palavra obrigatória não encontrada',
  EXCLUDE_KEYWORD_MATCHED: 'Palavra excluída encontrada',
  PRICE_BELOW_MINIMUM: 'Preço abaixo do mínimo',
  PRICE_ABOVE_MAXIMUM: 'Preço acima do máximo',
  DISCOUNT_BELOW_MINIMUM: 'Desconto abaixo do mínimo',
  RATING_BELOW_MINIMUM: 'Avaliação abaixo do mínimo',
  SALES_BELOW_MINIMUM: 'Vendas abaixo do mínimo',
  COMMISSION_BELOW_MINIMUM: 'Comissão abaixo do mínimo',
  SCORE_BELOW_MINIMUM: 'Score abaixo do mínimo',
  NICHE_INACTIVE: 'Nicho inativo',
  OFFER_UNAVAILABLE: 'Oferta indisponível',
  OFFER_EXPIRED: 'Oferta expirada',
  OFFER_NOT_STARTED: 'Oferta ainda não iniciada',
  MISSING_AFFILIATE_LINK: 'Link de afiliado ausente',
  INVALID_AFFILIATE_LINK: 'Link de afiliado inválido',
  STRUCTURAL_REJECTION: 'Dados comerciais inválidos',
  COMMERCIAL_NICHE_OFFICIAL_PRODUCT_REQUIRED: 'Oferta não oficial',
};

const readableReason = (code: string) => rejectionLabels[code] ?? code;

function KeywordEditor({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft('');
  };

  return (
    <div className="ops-control">
      <span className="ops-control-label">{label}</span>
      <span className="ops-control-sub">{hint}</span>
      <div className="mt-2 flex gap-2">
        <input
          className="ops-input min-w-0 flex-1"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          placeholder="Digite e adicione"
          aria-label={`Nova entrada em ${label}`}
        />
        <button type="button" className="ops-button" onClick={add}>
          <Plus size={14} aria-hidden="true" />
          Adicionar
        </button>
      </div>
      <div className="mt-2 flex min-h-8 flex-wrap gap-2" aria-label={label}>
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
          >
            {value}
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-slate-200"
              aria-label={`Remover ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function PreviewResult({
  report,
  categories,
}: {
  report: CommercialNichePreviewReport;
  categories: ShopeeCategory[];
}) {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const reasons = Object.entries(report.rejectionSummary).sort(
    ([, left], [, right]) => right - left,
  );

  return (
    <OpsSection
      title="Resultado do teste"
      meta="Catálogo OFFICIAL persistido · nenhuma oferta foi alterada"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="ops-kpi-card">
          <span className="ops-kpi-label">Produtos avaliados</span>
          <strong className="ops-kpi-value">{report.evaluatedCount}</strong>
          <span className="ops-kpi-detail">limite seguro do servidor</span>
        </div>
        <div className="ops-kpi-card" data-tone="success">
          <span className="ops-kpi-label">Compatíveis</span>
          <strong className="ops-kpi-value">{report.matchedCount}</strong>
          <span className="ops-kpi-detail">passaram todos os filtros</span>
        </div>
        <div className="ops-kpi-card" data-tone="warning">
          <span className="ops-kpi-label">Rejeitados</span>
          <strong className="ops-kpi-value">{report.rejectedCount}</strong>
          <span className="ops-kpi-detail">por regra comercial</span>
        </div>
      </div>

      {report.evaluationTruncated ? (
        <OpsState
          title="Catálogo parcialmente avaliado"
          message="O limite seguro de avaliação foi atingido. Reduza o catálogo ou refine o nicho para uma leitura completa."
          tone="warning"
        />
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            Resumo dos motivos
          </h3>
          {reasons.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">
              Nenhum produto foi rejeitado neste teste.
            </p>
          ) : (
            <ul className="mt-2 grid gap-2 text-sm text-slate-700">
              {reasons.map(([code, count]) => (
                <li key={code} className="flex items-center justify-between gap-3">
                  <span>{readableReason(code)}</span>
                  <OpsBadge tone="neutral">{count}</OpsBadge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-950">
            Amostra compatível
          </h3>
          {report.matches.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">
              Nenhum produto compatível na amostra.
            </p>
          ) : (
            <div className="mt-2 grid gap-2">
              {report.matches.map((item) => (
                <div key={item.productId} className="rounded-md border border-slate-200 p-3 text-sm">
                  <strong className="block text-slate-950">{item.productName}</strong>
                  <span className="mt-1 block text-slate-600">
                    {formatCurrency(Number(item.price))} · desconto {formatPercent(item.discountRate)} · score {item.finalScore}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {formatNumber(item.sales)} vendas · nota {item.rating.toLocaleString('pt-BR')} · comissão {formatPercent(item.commissionRate)}
                    {item.categoryIds.length > 0
                      ? ` · ${item.categoryIds.map((id) => categoryLabel(categoryMap.get(id))).join(', ')}`
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-slate-950">
          Amostra rejeitada
        </h3>
        {report.rejections.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">Nenhuma rejeição na amostra.</p>
        ) : (
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {report.rejections.map((item) => (
              <div key={item.productId} className="rounded-md border border-slate-200 p-3 text-sm">
                <strong className="block text-slate-950">{item.productName}</strong>
                <span className="mt-1 block text-slate-600">
                  {item.reasons.map(readableReason).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <details className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">
          Motivos técnicos
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {reasons.map(([code, count]) => (
            <span key={code} className="ops-mono text-xs text-slate-600">
              {code}={count}
            </span>
          ))}
        </div>
      </details>
    </OpsSection>
  );
}

export default function NichesPage() {
  const [niches, setNiches] = useState<CommercialNiche[]>([]);
  const [campaigns, setCampaigns] = useState<CommercialCampaign[]>([]);
  const [categories, setCategories] = useState<ShopeeCategory[]>([]);
  const [form, setForm] = useState<NicheForm>(emptyForm);
  const [categorySearch, setCategorySearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<CommercialNichePreviewReport | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nicheResponse, campaignResponse, categoryResponse] = await Promise.all([
        listCommercialNiches(1, 100),
        listCommercialCampaigns(1, 100),
        listShopeeCategories(),
      ]);
      setNiches(nicheResponse.items);
      setCampaigns(campaignResponse.items);
      setCategories(categoryResponse.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os nichos.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setPreview(null);
  }, [form]);

  const campaignCountByNiche = useMemo(() => {
    const counts = new Map<string, number>();
    for (const campaign of campaigns) {
      counts.set(campaign.nicheId, (counts.get(campaign.nicheId) ?? 0) + 1);
    }
    return counts;
  }, [campaigns]);
  const filteredCategories = useMemo(() => {
    const normalized = categorySearch.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return categories;
    return categories.filter((category) =>
      `${category.name ?? ''} ${category.displayLabel}`
        .toLocaleLowerCase('pt-BR')
        .includes(normalized),
    );
  }, [categories, categorySearch]);
  const visibleNiches = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('pt-BR');
    return niches.filter((niche) => {
      if (statusFilter === 'active' && !niche.active) return false;
      if (statusFilter === 'inactive' && niche.active) return false;
      return !normalized || niche.name.toLocaleLowerCase('pt-BR').includes(normalized);
    });
  }, [niches, search, statusFilter]);

  const selectCategories = (event: ChangeEvent<HTMLSelectElement>) => {
    setForm((current) => ({
      ...current,
      categoryIds: [
        ...current.categoryIds.filter(
          (id) => !filteredCategories.some((category) => category.id === id),
        ),
        ...Array.from(event.target.selectedOptions, (option) => option.value),
      ],
    }));
  };

  const startNew = () => {
    setForm(emptyForm());
    setPreview(null);
    setSuccess(null);
    setError(null);
  };

  const edit = (niche: CommercialNiche) => {
    setForm(formFromNiche(niche));
    setPreview(null);
    setSuccess(null);
    setError(null);
  };

  const runPreview = async () => {
    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    setPreviewing(true);
    setError(null);
    const previewInput = inputFromForm(form);
    const previewKey = JSON.stringify(previewInput);
    try {
      const report = await previewCommercialNiche(previewInput);
      if (JSON.stringify(inputFromForm(formRef.current)) === previewKey) {
        setPreview(report);
      }
    } catch (cause) {
      if (JSON.stringify(inputFromForm(formRef.current)) === previewKey) {
        setError(cause instanceof Error ? cause.message : 'Não foi possível testar o nicho.');
      }
    } finally {
      setPreviewing(false);
    }
  };

  const persist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    const existing = form.id ? niches.find((niche) => niche.id === form.id) : undefined;
    const usedBy = form.id ? campaignCountByNiche.get(form.id) ?? 0 : 0;
    if (existing?.active && !form.active && usedBy > 0) {
      const confirmed = window.confirm(
        `Este nicho é usado por ${usedBy} campanha(s). Ao desativá-lo, essas campanhas deixarão de selecionar produtos. Continuar?`,
      );
      if (!confirmed) return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = form.id
        ? await updateCommercialNiche(form.id, inputFromForm(form))
        : await createCommercialNiche(inputFromForm(form));
      setNiches((current) => {
        const withoutSaved = current.filter((item) => item.id !== saved.id);
        return [saved, ...withoutSaved];
      });
      setForm(formFromNiche(saved));
      setSuccess(`Nicho ${saved.name} salvo.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'O nicho não foi salvo.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (niche: CommercialNiche) => {
    const usedBy = campaignCountByNiche.get(niche.id) ?? 0;
    if (niche.active && usedBy > 0) {
      const confirmed = window.confirm(
        `Este nicho é usado por ${usedBy} campanha(s). Ao desativá-lo, essas campanhas deixarão de selecionar produtos. Continuar?`,
      );
      if (!confirmed) return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateCommercialNiche(niche.id, { active: !niche.active });
      setNiches((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (form.id === updated.id) setForm(formFromNiche(updated));
      setSuccess(`Nicho ${updated.name} ${updated.active ? 'ativado' : 'desativado'}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível alterar o status do nicho.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6">
      <OpsPageHeading
        eyebrow="Segmentação comercial"
        title="Nichos"
        description="Defina quais produtos podem entrar em cada campanha, sem confundir nicho com categoria Shopee."
        actions={
          <button type="button" className="ops-button" data-variant="primary" onClick={startNew}>
            <Plus size={14} aria-hidden="true" /> Novo nicho
          </button>
        }
      />

      {loading ? <OpsLoading label="Carregando nichos, campanhas e categorias" /> : null}
      {error ? <OpsState title="Nichos indisponíveis" message={error} tone="danger" /> : null}
      {success ? (
        <div className="ops-state" role="status" aria-live="polite">
          <Check size={16} aria-hidden="true" />
          <span>{success}</span>
        </div>
      ) : null}

      {!loading ? (
        <>
          <OpsSection title={form.id ? 'Editar nicho' : 'Criar nicho'} meta="O servidor valida e normaliza todos os campos antes de persistir.">
            <form className="grid gap-5" onSubmit={(event) => void persist(event)}>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                <label className="ops-control">
                  <span className="ops-control-label">Nome</span>
                  <input className="ops-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Maternidade" maxLength={80} />
                </label>
                <label className="ops-control">
                  <span className="ops-control-label">Status</span>
                  <select className="ops-input" value={form.active ? 'active' : 'inactive'} onChange={(event) => setForm((current) => ({ ...current, active: event.target.value === 'active' }))}>
                    <option value="active">Ativo</option>
                    <option value="inactive">Inativo</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="ops-control">
                  <span className="ops-control-label">Categorias Shopee</span>
                  <span className="ops-control-sub">Se selecionar categorias, o produto precisa pertencer a pelo menos uma delas.</span>
                  <label className="mt-2 block">
                    <span className="sr-only">Buscar categoria</span>
                    <input className="ops-input" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder="Buscar por nome" />
                  </label>
                  <select className="ops-input mt-2 min-h-36" multiple value={form.categoryIds} onChange={selectCategories} aria-label="Categorias Shopee do nicho">
                    {filteredCategories.map((category) => <option key={category.id} value={category.id}>{categoryLabel(category)}{category.productCount > 0 ? ` · ${category.productCount} oferta(s)` : ''}</option>)}
                  </select>
                  {categories.length === 0 ? <span className="ops-control-sub mt-2 block">Nenhuma categoria observada no catálogo persistido.</span> : null}
                  {form.categoryIds.length === 0 ? <span className="ops-control-sub mt-2 block">Sem categorias selecionadas = qualquer categoria.</span> : null}
                </div>
                <div className="grid gap-4">
                  <KeywordEditor label="Palavras obrigatórias" hint="Se preencher, o título precisa corresponder a pelo menos uma." values={form.includeKeywords} onChange={(values) => setForm((current) => ({ ...current, includeKeywords: values }))} />
                  <KeywordEditor label="Palavras excluídas" hint="Se encontrar qualquer uma, o produto é rejeitado." values={form.excludeKeywords} onChange={(values) => setForm((current) => ({ ...current, excludeKeywords: values }))} />
                </div>
              </div>

              <div>
                <p className="ops-control-label">Faixa de preço</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2">
                  <label className="ops-control"><span className="ops-control-label">Preço mínimo (R$)</span><input className="ops-input" type="number" min="0" step="0.01" value={form.minPrice ?? ''} onChange={(event) => setForm((current) => ({ ...current, minPrice: event.target.value }))} placeholder="Sem mínimo" /></label>
                  <label className="ops-control"><span className="ops-control-label">Preço máximo (R$)</span><input className="ops-input" type="number" min="0" step="0.01" value={form.maxPrice ?? ''} onChange={(event) => setForm((current) => ({ ...current, maxPrice: event.target.value }))} placeholder="Sem máximo" /></label>
                </div>
              </div>

              <div>
                <p className="ops-control-label">Qualidade e oportunidade</p>
                <p className="ops-control-sub">Todos os filtros preenchidos precisam ser satisfeitos. Percentuais usam a escala humana de 0% a 100%.</p>
                <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <label className="ops-control"><span className="ops-control-label">Desconto mínimo (%)</span><input className="ops-input" type="number" min="0" max="100" step="0.1" value={form.minDiscountRate} onChange={(event) => setForm((current) => ({ ...current, minDiscountRate: Number(event.target.value) }))} /></label>
                  <label className="ops-control"><span className="ops-control-label">Avaliação mínima</span><input className="ops-input" type="number" min="0" max="5" step="0.1" value={form.minRating} onChange={(event) => setForm((current) => ({ ...current, minRating: Number(event.target.value) }))} /></label>
                  <label className="ops-control"><span className="ops-control-label">Vendas mínimas</span><input className="ops-input" type="number" min="0" step="1" value={form.minSales} onChange={(event) => setForm((current) => ({ ...current, minSales: Number(event.target.value) }))} /></label>
                  <label className="ops-control"><span className="ops-control-label">Comissão mínima (%)</span><input className="ops-input" type="number" min="0" max="100" step="0.1" value={form.minCommissionRate} onChange={(event) => setForm((current) => ({ ...current, minCommissionRate: Number(event.target.value) }))} /></label>
                  <label className="ops-control"><span className="ops-control-label">Score mínimo</span><input className="ops-input" type="number" min="0" max="100" step="1" value={form.minimumScore} onChange={(event) => setForm((current) => ({ ...current, minimumScore: Number(event.target.value) }))} /></label>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                <button type="button" className="ops-button" onClick={() => void runPreview()} disabled={previewing || saving}>
                  <Eye size={14} aria-hidden="true" /> {previewing ? 'Testando…' : 'Testar nicho'}
                </button>
                <button type="submit" className="ops-button" data-variant="primary" disabled={saving || previewing}>
                  <Save size={14} aria-hidden="true" /> {saving ? 'Salvando…' : 'Salvar nicho'}
                </button>
              </div>
            </form>
          </OpsSection>

          {preview ? <PreviewResult report={preview} categories={categories} /> : null}

          <OpsSection title="Nichos cadastrados" meta={`${visibleNiches.length} de ${niches.length} nicho(s)`}>
            <div className="grid gap-4 border-b border-slate-200 pb-4 md:grid-cols-[minmax(0,1fr)_180px]">
              <label className="ops-control"><span className="ops-control-label">Buscar por nome</span><span className="relative"><Filter size={14} className="pointer-events-none absolute left-3 top-3 text-slate-400" aria-hidden="true" /><input className="ops-input pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Maternidade, Achadinhos…" /></span></label>
              <label className="ops-control"><span className="ops-control-label">Status</span><select className="ops-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Todos</option><option value="active">Ativos</option><option value="inactive">Inativos</option></select></label>
            </div>
            {visibleNiches.length === 0 ? <OpsEmpty title="Nenhum nicho encontrado" message="Crie um nicho ou ajuste os filtros desta lista." /> : <div className="mt-4 grid gap-3 md:grid-cols-2">{visibleNiches.map((niche) => { const usedBy = campaignCountByNiche.get(niche.id) ?? 0; return <article key={niche.id} className="rounded-md border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h3 className="ops-card-title">{niche.name}</h3><OpsBadge tone={niche.active ? 'success' : 'neutral'}>{niche.active ? 'ATIVO' : 'INATIVO'}</OpsBadge></div><p className="mt-1 text-sm text-slate-600">{usedBy} campanha(s) utilizam este nicho</p></div><Tags size={18} className="text-orange-600" aria-hidden="true" /></div><div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600"><span className="rounded-full bg-slate-100 px-2.5 py-1">{niche.categoryIds.length ? `${niche.categoryIds.length} categoria(s)` : 'Qualquer categoria'}</span><span className="rounded-full bg-slate-100 px-2.5 py-1">{niche.includeKeywords.length ? `${niche.includeKeywords.length} palavra(s)` : 'Sem palavra obrigatória'}</span><span className="rounded-full bg-slate-100 px-2.5 py-1">Até {niche.maxPrice ? formatCurrency(Number(niche.maxPrice)) : 'sem limite'}</span></div><div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" className="ops-button" onClick={() => edit(niche)}><Edit3 size={14} aria-hidden="true" /> Editar</button><button type="button" className="ops-button" data-variant={niche.active ? 'danger' : 'primary'} disabled={saving} onClick={() => void toggle(niche)}>{niche.active ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}{niche.active ? 'Desativar' : 'Ativar'}</button></div></article>; })}</div>}
          </OpsSection>

          <OpsSection title="Como a segmentação funciona" meta="A mesma regra pode ser reutilizada por várias campanhas.">
            <div className="grid gap-3 text-sm leading-6 text-slate-700 md:grid-cols-2">
              <p><strong>Nicho não é categoria Shopee.</strong> Um nicho transversal como “Achadinhos” pode deixar categorias e palavras obrigatórias vazias e usar somente filtros comerciais.</p>
              <p><strong>Categorias e palavras são cumulativas.</strong> Quando ambas existem, o produto precisa passar pela interseção de categoria e por pelo menos uma palavra obrigatória.</p>
              <p><strong>Desativar é reversível.</strong> Campanhas que usam um nicho inativo permanecem registradas, mas o runtime bloqueia novas seleções até a reativação ou troca explícita.</p>
              <p><strong>Testar nicho é somente leitura.</strong> O preview usa o catálogo oficial já persistido; não gera copy, candidate, fila ou envio.</p>
            </div>
          </OpsSection>
        </>
      ) : null}
    </div>
  );
}

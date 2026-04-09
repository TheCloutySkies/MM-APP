-- Immediate & tactical ops report kinds: SPOTREP (SALUTE), 9-line MEDEVAC, route reconnaissance.

alter table public.ops_reports drop constraint if exists ops_reports_doc_kind_check;

alter table public.ops_reports add constraint ops_reports_doc_kind_check check (
  doc_kind in (
    'mission_plan',
    'sitrep',
    'aar',
    'target_package',
    'intel_report',
    'spotrep',
    'medevac_nine_line',
    'route_recon'
  )
);

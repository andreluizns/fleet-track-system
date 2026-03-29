'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface AlertRecord {
  placa: string;
  geofence_name: string;
  tipo: 'entry' | 'exit';
  timestamp: string;
}

export default function ReportExporter() {
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/geofence-alerts`);
      if (!res.ok) throw new Error('Falha ao buscar dados do servidor');
      const data: AlertRecord[] = await res.json() as AlertRecord[];

      const { default: jsPDF } = await import('jspdf');
      const { default: autoTable } = await import('jspdf-autotable');

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      // Title
      doc.setFontSize(16);
      doc.setTextColor(15, 23, 42);
      doc.text('Relatório de Violações de Cerca — Fleet Track', 14, 20);

      // Generation date
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      doc.text(`Gerado em: ${now}`, 14, 28);

      // Table
      const rows = data.map((item) => [
        item.placa,
        item.geofence_name,
        item.tipo === 'exit' ? 'Saiu da cerca' : 'Entrou na cerca',
        new Date(item.timestamp).toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
        }),
      ]);

      autoTable(doc, {
        startY: 34,
        head: [['Placa', 'Geofence', 'Tipo', 'Data/Hora']],
        body: rows,
        styles: {
          fontSize: 9,
          cellPadding: 3,
        },
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [248, 250, 252],
          fontStyle: 'bold',
        },
        alternateRowStyles: {
          fillColor: [241, 245, 249],
        },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 30 },
          1: { cellWidth: 50 },
          2: { cellWidth: 40 },
          3: { cellWidth: 60 },
        },
      });

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        const pageH = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Total de violações: ${data.length}   |   Página ${i} de ${pageCount}`,
          14,
          pageH - 8
        );
      }

      const filename = `fleet-track-relatorio-${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      alert(`Erro ao gerar relatório: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={() => void handleExport()}
      disabled={loading}
      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-400 disabled:bg-sky-800 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg transition-colors"
    >
      {loading ? (
        <>
          <svg
            className="animate-spin h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          Gerando PDF...
        </>
      ) : (
        <>
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Exportar Relatório PDF
        </>
      )}
    </button>
  );
}

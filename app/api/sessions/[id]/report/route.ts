import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session-store';
import { launchBrowser } from '@/lib/browser';
import {
  buildReportData,
  generateHtmlReport,
  generateMarkdownReport,
  generateJsonReport,
  generateCsvReport,
} from '@/lib/generate-report';


export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const format = req.nextUrl.searchParams.get('format') ?? 'html';
  const data = buildReportData(session);
  const slug = session.url.replace(/https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
  const ts = new Date().toISOString().slice(0, 10);
  const base = `testpilot-report-${slug}-${ts}`;

  switch (format) {
    case 'html': {
      const html = generateHtmlReport(data);
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="${base}.html"`,
        },
      });
    }

    case 'pdf': {
      // Render HTML via Playwright and return the PDF bytes
      const html = generateHtmlReport(data);
      const browser = await launchBrowser();
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle' });
        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
        });
        const pdf = new Uint8Array(pdfBuffer);
        return new NextResponse(pdf, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${base}.pdf"`,
          },
        });
      } finally {
        await browser.close();
      }
    }

    case 'markdown':
    case 'md': {
      const md = generateMarkdownReport(data);
      return new NextResponse(md, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${base}.md"`,
        },
      });
    }

    case 'json': {
      const json = generateJsonReport(data);
      return new NextResponse(json, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${base}.json"`,
        },
      });
    }

    case 'csv': {
      const csv = generateCsvReport(data);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${base}.csv"`,
        },
      });
    }

    default:
      return NextResponse.json(
        { error: `Unknown format "${format}". Use html, pdf, markdown, json, or csv.` },
        { status: 400 },
      );
  }
}

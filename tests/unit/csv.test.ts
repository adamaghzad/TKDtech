import{describe,expect,it}from'vitest';
import{csvImportMessage,importCsvFile,parseCsv,parseCsvRecords}from'../../apps/web/lib/csv';

describe('registration CSV parsing',()=>{
 it('parses UTF-8 BOM, CRLF, quoted commas, escaped quotes, and quoted newlines',()=>{
  expect(parseCsv('\uFEFFname,notes\r\n"Atlas, Casablanca","Coach said ""ready"""\r\n"Riad Rabat","Line one\nLine two"\r\n')).toEqual([['name','notes'],['Atlas, Casablanca','Coach said "ready"'],['Riad Rabat','Line one\nLine two']]);
 });
 it('requires headers and rejects a header-only file',()=>{
  expect(()=>parseCsvRecords('name,country\n', ['name'])).toThrow(/no data rows/i);expect(()=>parseCsvRecords('name\nAtlas\n',['countryCode'])).toThrow(/countryCode/);
 });
 it('caps processing at 500 rows while reporting the total',()=>{
  const text=`name\n${Array.from({length:501},(_,index)=>`Club ${index+1}`).join('\n')}`;const result=parseCsvRecords(text,['name']);expect(result.records).toHaveLength(500);expect(result.totalRows).toBe(501);expect(result.records[499]?.name).toBe('Club 500');
 });
 it('continues after rejected rows and summarizes failures',async()=>{
  const file={text:async()=>'name\nAtlas\nInvalid\nRiad'} as File;const result=await importCsvFile(file,['name'],async record=>{if(record.name==='Invalid')throw new Error('Invalid country code.');},record=>record.name||'');
  expect(result).toMatchObject({completed:2,totalRows:3,processedRows:3});expect(result.failures).toEqual(['Invalid: Invalid country code.']);expect(csvImportMessage(result,'clubs')).toContain('2 clubs imported. 1 rejected.');expect(csvImportMessage(result,'clubs')).toContain('Invalid country code');
 });
});

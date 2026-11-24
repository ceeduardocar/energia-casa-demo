-- Testa o próprio executor de testes e as funções de asserção.
begin;

select test.eq('soma', 1 + 1, 2);
select test.ok('verdade', true);
select test.throws('divisão por zero', 'select 1/0');
select test.is_null('nulo', null::int);

rollback;

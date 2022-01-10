import { createStore, derive, enableAsyncActionPayloads, enableNesting } from 'olik';
import { BehaviorSubject, from, of } from 'rxjs';
import { catchError, concatMap, skip, tap } from 'rxjs/operators';

import {
  augmentCore,
  combineComponentObservables,
} from '../src/lib/olik-ng.module';

describe('Angular', () => {

  const initialState = {
    object: { property: 'a' },
    array: [{ id: 1, value: 'one' }, { id: 2, value: 'two' }, { id: 3, value: 'three' }],
    string: 'b',
  };

  beforeAll(() => {
    enableAsyncActionPayloads();
    enableNesting();
    augmentCore();
  })

  it('should create and update a store', () => {
    const select = createStore({ name: '', state: initialState });
    select.object.property
      .replace('test');
    expect(select.state.object.property).toEqual('test');
  })

  it('should be able to observe state updates', done => {
    const select = createStore({ name: '', state: initialState });
    const obs$ = select.object.property.observe();
    const payload = 'test';
    obs$.pipe(
      skip(1)
    ).subscribe(val => {
      expect(val).toEqual(payload);
      done();
    });
    select.object.property.replace(payload);
  })

  it('should be able to observe the status of a resolved fetch', done => {
    const select = createStore({ name: '', state: initialState });
    let count = 0;
    const fetchProperty = () => from(new Promise<string>(resolve => setTimeout(() => resolve('val ' + count), 10)));
    select.object.property
      .replace(fetchProperty)
      .asObservableFuture()
      .subscribe(val => {
        count++;
        if (count === 1) {
          expect(val.isLoading).toEqual(true);
          expect(val.wasRejected).toEqual(false);
          expect(val.wasResolved).toEqual(false);
          expect(val.error).toEqual(null);
          expect(val.storeValue).toEqual(initialState.object.property);
        } else if (count === 2) {
          expect(val.isLoading).toEqual(false);
          expect(val.wasRejected).toEqual(false);
          expect(val.wasResolved).toEqual(true);
          expect(val.error).toEqual(null);
          expect(val.storeValue).toEqual('val 1');
          done();
        }
      });
  })

  it('should be able to observe the status of a rejected fetch', done => {
    const select = createStore({ name: '', state: initialState });
    let count = 0;
    const fetchAndReject = () => new Promise<string>((resolve, reject) => setTimeout(() => reject('test'), 10));
    select.object.property
      .replace(fetchAndReject)
      .asObservableFuture()
      .subscribe(val => {
        count++;
        if (count === 1) {
          expect(val.isLoading).toEqual(true);
          expect(val.wasRejected).toEqual(false);
          expect(val.wasResolved).toEqual(false);
          expect(val.error).toEqual(null);
        } else if (count === 2) {
          expect(val.isLoading).toEqual(false);
          expect(val.wasRejected).toEqual(true);
          expect(val.wasResolved).toEqual(false);
          expect(val.error).toEqual('test');
          expect(val.storeValue).toEqual('a');
          done();
        }
      });
  })

  it('should be able to observe a resolved fetch', done => {
    const select = createStore({ name: '', state: initialState });
    const payload = 'val';
    const fetchProperty = () => from(new Promise<string>(resolve => setTimeout(() => resolve(payload), 10)));
    select.object.property
      .replace(fetchProperty)
      .asObservable()
      .subscribe(val => {
        expect(val).toEqual(payload)
        done();
      })
  })

  it('should be able to observe a rejected fetch', done => {
    const select = createStore({ name: '', state: initialState });
    const payload = 'val';
    const fetchProperty = () => from(new Promise<string>((resolve, reject) => setTimeout(() => reject(payload), 10)));
    select.object.property
      .replace(fetchProperty)
      .asObservable().pipe(
        catchError(e => of('error: ' + e))
      )
      .subscribe(val => {
        expect(val).toEqual('error: ' + payload)
        done();
      })
  })

  it('should observe a derivation', done => {
    const select = createStore({ name: '', state: initialState });
    derive(
      select.object.property,
      select.string,
    ).with((a, b) => a + b)
      .observe()
      .subscribe(val => {
        expect(val).toEqual('ab');
        done();
      });
  })

  it('should observe a nested store update', done => {
    const select = createStore({ name: 'x', state: initialState });
    const nested = createStore({ state: { hello: 'abc' }, name: 'component', tryToNestWithinStore: 'x' });
    const replacement = 'xxx';
    nested.hello
      .observe()
      .subscribe(e => {
        if (e === replacement) {
          done();
        }
      });
    nested.hello.replace(replacement);
  })

  it('should combineComponentObservables', done => {
    const select = createStore({ name: '', state: initialState });
    let count = 0;
    class MyClass {
      obs1$ = select.object.property.observe();
      obs2$ = select.string.observe();
      obs$ = combineComponentObservables<MyClass>(this);
      constructor() {
        this.obs$.subscribe(e => {
          count++;
          if (count === 2) {
            const expectation = { obs1$: 'a', obs2$: 'b' };
            expect(e).toEqual(expectation);
            expect(this.obs$.value).toEqual(expectation);
          } else if (count === 3) {
            const expectation = { obs1$: 'b', obs2$: 'b' };
            expect(e).toEqual(expectation);
            expect(this.obs$.value).toEqual(expectation);
            done();
          }
        });
        select.object.property.replace('b');
      }
    };
    new MyClass();
  })

  it('should be able to paginate', done => {
    const select = createStore({ name: '', state: initialState });
    const page$ = new BehaviorSubject(0);
    const idle$ = new BehaviorSubject(false);
    const items = Array(100).fill(null).map((e, i) => ({ id: i, value: `value ${i}` }));
    const fetchItems = (page: number) => () => new Promise<{ id: number, value: string }[]>(
      resolve => setTimeout(() => resolve(items.slice(page * 10, (page * 10) + 10)), 500));
    select.array.removeAll();
    const sub = page$.pipe(
      concatMap(page => select.array
        .replaceAll(fetchItems(page))
        .asObservableFuture()),
      tap(r => {
        if (r.wasResolved) {
          expect(r.storeValue).toEqual(items.slice(page$.value * 10, (page$.value * 10) + 10))
          idle$.next(!idle$.value);
          if (page$.value === 5) {
            sub.unsubscribe();
            done();
          }
        }
      })
    ).subscribe();
    idle$.pipe(
      skip(1),
      tap(() => page$.next(page$.value + 1))
    ).subscribe();
  })


  // // reactive version
  // const paginatedData$ = this.pageIndex$.pipe(
  //   concatMap(pageIndex => observeFetch(select(s => s.data[pageIndex]).replaceAll(() => fetchData(pageIndex, 10)))),
  // );

  // // imperative version
  // select(s => s.data[pageIndex])
  //   .replaceAll(() => fetchData(index, 10))
  //   .subscribe(data => setData(data));

});

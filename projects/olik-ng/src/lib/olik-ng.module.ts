import { EventEmitter, NgZone } from '@angular/core';
import { combineLatest, from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import * as core from 'olik';

export * from 'olik';

export const createApplicationStore: typeof core['createApplicationStore'] = (state, options) => {
  augementCore();
  return core.createApplicationStore(state, options);
}

export const createComponentStore: typeof core['createComponentStore'] = (state, options) => {
  augementCore();
  return core.createComponentStore(state, options);
}

export const syncNgZoneWithDevtools = (ngZone: NgZone) => core.listenToDevtoolsDispatch(() => ngZone.run(() => null));

declare module 'olik' {
  interface StoreOrDerivation<C> {
    /**
     * Returns an Observable to track updates to the selected node of the state tree
     * @example
     * select(s => s.todos)
     *   .observe()
     *   .subscribe(todos => console.log(todos)); 
     */
    observe: () => Observable<C>;
  }
  interface ArrayOfElementsCommonAction<X extends core.DeepReadonlyArray<any>, F extends core.FindOrFilter, T extends core.Trackability> {
    observe: () => Observable<F extends 'find' ? X[0] : X>;
  }
  interface Future<C> {
    asObservableFuture: () => Observable<core.FutureState<C>>;
    asObservable: () => Observable<C>;
  }
  interface Async<C> extends Observable<C> {
  }
  interface Derivation<R> {
    observe: () => Observable<R>;
  }
}

type FunctionParameter<T> = T extends (arg: infer H) => any ? H : never;
type ClassObservables<T> = {
  [I in keyof T]: T[I] extends Observable<any> ? FunctionParameter<Parameters<T[I]['subscribe']>[0]> : never;
};
type SubType<Base, Condition> = Pick<Base, {
  [Key in keyof Base]: Base[Key] extends Condition ? Key : never
}[keyof Base]>;
type Observables<T> = ClassObservables<SubType<Omit<T, 'observables$'>, Observable<any>>>;

/**
 * Takes a component instance, finds all its observables, and combines them into 1 observable for the template to consume.
 * This has the added benefit of allowing you to access all observable values synchronously as well as view your observable
 * values inside the Angular devtool extension.
 *
 * @example
 * ```
 * <ng-container *ngIf="observables$ | async; let observe;">
 *   <div>Observable 1: {{observe.observable1$}}</div>
 *   <div>Observable 2: {{observe.observable2$}}</div>
 * </ng-container>
 *
 * class MyComponent {
 *   readonly observable1$ = ...;
 *   readonly observable2$ = ...;
 *   readonly observables$ = combineComponentObservables<MyComponent>(this);
 *
 *   ngAfterViewInit() {
 *     // synchronous access to observable values
 *     const observable1Value = this.$observables.value.observable1$;
 *   }
 * }
 * ```
 */
export const combineComponentObservables = <T>(component: T): Observable<Observables<T>> & { value: Observables<T> } => {
  const keysOfObservableMembers = Object.keys(component)
    .filter(key => (component as any)[key] instanceof Observable && !((component as any)[key] instanceof EventEmitter));
  const res = combineLatest(
    keysOfObservableMembers.map(key => (component as any)[key] as Observable<any>)
  ).pipe(
    map(observers => {
      const result = {} as { [key: string]: any };
      observers.forEach((obs, idx) => result[keysOfObservableMembers[idx]] = obs);
      (component as any).$observables = result;
      (res as any).value = result;
      return result as Observables<T>;
    })
  );
  return res as Observable<Observables<T>> & { value: Observables<T> };
};

let coreHasBeenAgmented = false;
const augementCore = () => {
  if (coreHasBeenAgmented) { return; }
  coreHasBeenAgmented = true;
  core.augment({
    selection: {
      observe: <C>(selection: core.StoreOrDerivation<C>) => () => new Observable<any>(observer => {
        observer.next(selection.read());
        const subscription = selection.onChange(v => observer.next(v));
        return () => subscription.unsubscribe();
      }),
    },
    future: {
      asObservableFuture: (input) => () => new Observable<any>(observer => {

        // Call promise, and update state because there may have been an optimistic update
        const promise = input.asPromise();
        observer.next(input.getFutureState());

        // Invoke then() on promise
        let running = true;
        promise
          .then(() => { if (running) { observer.next(input.getFutureState()); } })
          .catch(() => { if (running) { observer.next(input.getFutureState()); } });
        return () => { running = false; }
      }),
      asObservable: (future) => () => from(future.asPromise())
    },
    derivation: {
      observe: <R>(selection: core.Derivation<R>) => () => new Observable<any>(observer => {
        observer.next(selection.read());
        const subscription = selection.onChange(v => observer.next(v));
        return () => subscription.unsubscribe();
      }),
    },
    async: <C>(fnReturningFutureAugmentation: () => any) => {
      const promiseOrObservable = fnReturningFutureAugmentation();
      return promiseOrObservable.then ? promiseOrObservable : (promiseOrObservable as Observable<C>).toPromise()
    },
  })
}
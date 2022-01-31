import { CommonModule } from '@angular/common';
import { ApplicationRef, EventEmitter, NgModule } from '@angular/core';
import { augment, DeepReadonly, Derivation, FutureState, listenToDevtoolsDispatch, Readable } from 'olik';
import { combineLatest, from, Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

declare module 'olik' {
  interface Readable<S> {
    $observe: () => Observable<DeepReadonly<S>>;
  }
  interface Derivation<R> {
    $observe: () => Observable<DeepReadonly<R>>;
  }
  interface Future<C> {
    $asObservableFuture: () => Observable<FutureState<DeepReadonly<C>>>;
    $asObservable: () => Observable<DeepReadonly<C>>;
  }
  interface Async<C> extends Observable<C> {
  }
}

type FunctionParameter<T> = T extends (arg: infer H) => any ? H : never;
type ClassObservables<T> = {
  [I in keyof T]: T[I] extends Observable<any> ? FunctionParameter<Parameters<T[I]['subscribe']>[0]> : never;
};
type SubType<Base, Condition> = Pick<Base, {
  [Key in keyof Base]: Base[Key] extends Condition ? Key : never
}[keyof Base]>;
type Observables<T> = ClassObservables<SubType<Omit<T, 'obs$'>, Observable<any>>>;

/**
 * Takes a component instance, finds all its observables, and combines them into 1 observable for the template to consume.
 * This has the added benefit of allowing you to access all observable values synchronously as well as view your observable
 * values inside the Angular devtool extension.
 *
 * @example
 * ```
 * <ng-container *ngIf="obs$ | async; let obs;">
 *   <div>Observable 1: {{obs.observable1$}}</div>
 *   <div>Observable 2: {{obs.observable2$}}</div>
 * </ng-container>
 *
 * class MyComponent {
 *   readonly observable1$ = ...;
 *   readonly observable2$ = ...;
 *   readonly obs$ = combineComponentObservables<MyComponent>(this);
 *
 *   ngAfterViewInit() {
 *     // synchronous access to observable values
 *     const observable1Value = this.$obs.observable1$;
 *   }
 * }
 * ```
 */
export const combineComponentObservables = <T>(component: T) => {
  const keysOfObservableMembers = Object.keys(component)
    .filter(key => (component as any)[key] instanceof Observable && !((component as any)[key] instanceof EventEmitter));
  const res = combineLatest(
    keysOfObservableMembers.map(key => ((component as any)[key] as Observable<any>).pipe(startWith(undefined)))
  ).pipe(
    map(observers => {
      const result = {} as { [key: string]: any };
      observers.forEach((obs, idx) => result[keysOfObservableMembers[idx]] = obs);
      Object.assign(res, result);
      return result as Observables<T>;
    })
  );
  return res as Observable<Observables<T>> & DeepReadonly<Observables<T>>;
};

@NgModule({
  imports: [CommonModule],
})
export class OlikNgModule {
  constructor(appRef: ApplicationRef) {
    listenToDevtoolsDispatch(() => appRef.tick());
    augmentCore();
  }
}

export const augmentCore = () => {
  augment({
    selection: {
      $observe: <C>(selection: Readable<C>) => () => new Observable<any>(observer => {
        observer.next(selection.$state);
        const subscription = selection.$onChange(v => observer.next(v));
        return () => { subscription.unsubscribe(); observer.complete(); }
      }),
    },
    future: {
      $asObservableFuture: (input) => () => new Observable<any>(observer => {
        let running = true;
        input
          .then(() => { if (running) { observer.next(input.state); observer.complete(); } })
          .catch(() => { if (running) { observer.next(input.state); observer.complete(); } });
        observer.next(input.state);
        return () => { running = false; observer.complete(); }
      }),
      $asObservable: (input) => () => {
        return from(Promise.resolve(input));
      }
    },
    derivation: {
      $observe: <R>(selection: Derivation<R>) => () => new Observable<any>(observer => {
        observer.next(selection.$state);
        const subscription = selection.$onChange(v => observer.next(v));
        return () => { subscription.unsubscribe(); observer.complete(); }
      }),
    },
    async: <C>(fnReturningFutureAugmentation: () => any) => {
      const promiseOrObservable = fnReturningFutureAugmentation();
      return promiseOrObservable.then ? promiseOrObservable : (promiseOrObservable as Observable<C>).toPromise()
    },
  })
}

import * as _ from 'lodash';
import * as fsExtra from 'fs-extra';
import * as Ajv from 'ajv';

import {
    OApiStructure,
    Schema
} from "../../oapi-defs";
import {
    BaseConvertor,
    ConvertorConfig,
    defaultConfig
} from "../../core";

import {
    DataTypeContainer,
    DataTypeDescriptor,
    DescriptorContext
} from '../../core';

// правила для определения дипа дескриптора
import { rules } from "./descriptors";

/**
 * Класс загрузчика для TypeScript.
 */
export class Convertor extends BaseConvertor {

    /**
     * Рекурсивный рендеринг
     * [контенейра дескрипторов типов]{@link DataTypeContainer}
     * с ренлерингом всех их зависиомостей.
     *
     * @param {DataTypeContainer} typeContainer
     * Типы, которые нужно отрендерить.
     * @param {(descriptor: DataTypeDescriptor, text) => void} renderedCallback
     * Колбэк, который срабатывает при рендеринге типа.
     * @param {DataTypeContainer} alreadyRendered
     * Типы, которые уже отрендерены, и их рендерить не нужно
     * @param {boolean} rootLevel
     * `false`, если это дочерний "процес"
     * @returns {string[]}
     */
    public static renderRecursive(
        typeContainer: DataTypeContainer,
        renderedCallback: (descriptor: DataTypeDescriptor, text) => void,
        alreadyRendered: DataTypeContainer = []
    ): void {
        let result = [];

        _.each(typeContainer, (descr: DataTypeDescriptor) => {

            let childrenDependencies = [];

            // если этот тип еще не рендерился
            if(_.findIndex(
                alreadyRendered,
                v => v.toString() === descr.toString()
            ) !== -1) {
                return;
            } else {
                // помечает, что на следующем этапе не нужно
                // обрабатывать уже обработанные типы
                alreadyRendered.push(descr);
            }

            /**
             * Рендеринг очередного типа из очереди
             * @type {string}
             */
            const renderResult = descr.render(
                childrenDependencies,
                true
            );

            // далее, рекурсивно нужно просчитать зависимости
            this.renderRecursive(
                // только те, которые еще не были просчитаны
                _.filter(
                    childrenDependencies,
                    (ov) => {
                        return _.findIndex(
                            alreadyRendered,
                            iv => ov.toString() === iv.toString()
                        ) === -1
                    }
                ),
                renderedCallback,
                alreadyRendered
            );

            // Колбэк вызывается в конце, чтобы типы-зависимости
            // шли впереди использующих их.
            renderedCallback(descr, renderResult);
        });
    }

    protected _ajv;

    constructor(
        /**
         * Конфигурация для конвертора.
         * @type {ConvertorConfig}
         */
        protected config: ConvertorConfig = defaultConfig
    ) {
        super(config);
        this._ajv = new Ajv();
    }

    /**
     * Превращение JSON-схемы в описание типа данных.
     * Возвращает контейнер [дескрипторов типов]{@link DataTypeDescriptor},
     * в котором перечисляются типы данных (возможна принадлежность
     * к более чем одному типу данных: `number[] | InterfaceName`).
     *
     * @param {Schema} schema
     * Схема, для которой будет подобрано соответствущее
     * правило, по которому будет определен дескриптор
     * нового типа данных.
     * @param {Object} context
     * Контекст, в котором хранятся ранее просчитаные модели
     * в рамках одной цепочки обработки.
     * @param {string} name
     * Собственное имя типа данных
     * @param {string} suggestedName
     * Предлагаемое имя для типа данных: может
     * применяться, если тип данных анонимный, но
     * необходимо вынести его за пределы родительской
     * модели по-ситуации (например, в случае с Enum).
     * @param {string} originalPathSchema
     * Путь, по которому была взята схема
     * @returns {DataTypeContainer}
     */
    public convert(
        schema: Schema,
        context: DescriptorContext,
        name?: string,
        suggestedName?: string,
        originalPathSchema?: string
    ): DataTypeContainer {

        let variantsOf;

        // получение по $ref
        if (schema['$ref']) {
            const refSchema = this.findTypeByPath(
                schema['$ref'],
                context
            );

            // если вся схема состоит только из "$ref",
            // то просто возвращается найденный дескриптор
            if(_.values(schema).length === 1) {
                return refSchema;
            } else {
                // fixme: отследить, будет ли испоьзоваться этот сценарий
                // fixme: здесь нужен эффективный механизм смешения уже готовой схемы с надстройкой
                // fixme: пока просто валит ошибку
                throw new Error(
                    `Error (fix this place?): you should't get '$ref' and other properties as neighbors.`
                );
            }
        }

        // основной сценарий
        else {
            const constructor = this._findMatchedConstructor(schema);

            return constructor
                ? [new constructor(
                    schema,
                    this,
                    context,
                    name,
                    suggestedName,
                    originalPathSchema
                )]
                : null;
        }
    }

    /**
     * Поиск конструктора для дескриптора типа данных,
     * условиям которого, удовлетворяет данная схема.
     *
     * @param {Schema} schema
     * @returns {any}
     * @private
     */
    protected _findMatchedConstructor(schema: Schema): any {
        return (_.find(rules, (item) => {
            if (!item._schemaComplied)
                item._schemaComplied = this._ajv.compile(item.rule);
            return item._schemaComplied(schema);
        }) || {}).classConstructor;
    }
}
